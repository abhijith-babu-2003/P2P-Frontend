import React, { useState, useRef, useEffect } from 'react';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Monitor, Users } from 'lucide-react';
import io from 'socket.io-client';

const VideoCallApp = () => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [isInRoom, setIsInRoom] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const originalStreamRef = useRef(null);
  const isGettingMediaRef = useRef(false);
  const isInitiatorRef = useRef(false);

  const SOCKET_SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:3007';
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  useEffect(() => {
    socketRef.current = io(SOCKET_SERVER, { transports: ['websocket', 'polling'] });

    socketRef.current.on('connect', () => setConnectionStatus('connected'));
    socketRef.current.on('disconnect', () => setConnectionStatus('disconnected'));

    socketRef.current.on('joined-room', (room) => {
      setIsInRoom(true);
    });

    socketRef.current.on('room-full', () => {
      alert('Room is full! Maximum 2 users allowed.');
      setConnectionStatus('disconnected');
      setIsInRoom(false);
    });

    socketRef.current.on('other-user', (userId) => {
      isInitiatorRef.current = true;
      createPeerConnection(userId);
      setTimeout(() => createOffer(userId), 100);
    });

    socketRef.current.on('user-joined', (userId) => {
      isInitiatorRef.current = false;
      createPeerConnection(userId);
    });

    socketRef.current.on('offer', async ({ offer, from }) => {
      if (!peerConnectionRef.current) createPeerConnection(from);
      try {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnectionRef.current.createAnswer();
        await peerConnectionRef.current.setLocalDescription(answer);
        socketRef.current.emit('answer', { answer, to: from });
      } catch (error) {
        console.error('Error handling offer:', error);
      }
    });

    socketRef.current.on('answer', async ({ answer }) => {
      if (peerConnectionRef.current.signalingState === 'have-local-offer') {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socketRef.current.on('ice-candidate', async ({ candidate }) => {
      if (peerConnectionRef.current) {
        try { await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate)); }
        catch (error) { console.error('Error adding ICE candidate:', error); }
      }
    });

    socketRef.current.on('user-left', () => handlePeerDisconnect());

    return () => {
      socketRef.current?.disconnect();
      localStream?.getTracks().forEach(track => track.stop());
      peerConnectionRef.current?.close();
    };
  }, []);

  const createPeerConnection = (userId) => {
    if (peerConnectionRef.current) peerConnectionRef.current.close();
    const peerConnection = new RTCPeerConnection(iceServers);
    peerConnectionRef.current = peerConnection;

    const streamToUse = localStream || originalStreamRef.current;
    if (streamToUse) {
      streamToUse.getTracks().forEach(track => peerConnection.addTrack(track, streamToUse));
    }

    peerConnection.ontrack = (event) => {
      const stream = event.streams[0];
      setRemoteStream(stream);
      setIsConnected(true);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.onloadedmetadata = () => remoteVideoRef.current.play().catch(() => {});
      }
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', { candidate: event.candidate, to: userId });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      setConnectionStatus(peerConnection.connectionState);
      if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
        handlePeerDisconnect();
      }
    };

    peerConnection.onnegotiationneeded = async () => {
      if (isInitiatorRef.current) await createOffer(userId);
    };

    return peerConnection;
  };

  const createOffer = async (userId) => {
    if (!peerConnectionRef.current) return;
    const offer = await peerConnectionRef.current.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await peerConnectionRef.current.setLocalDescription(offer);
    socketRef.current.emit('offer', { offer, to: userId });
  };

  const startWebcam = async () => {
    if (isGettingMediaRef.current) return;
    isGettingMediaRef.current = true;

    try {
      localStream?.getTracks().forEach(track => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
      setLocalStream(stream);
      originalStreamRef.current = stream;
      localVideoRef.current.srcObject = stream;

      if (peerConnectionRef.current) {
        stream.getTracks().forEach(track => {
          const sender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === track.kind);
          sender ? sender.replaceTrack(track) : peerConnectionRef.current.addTrack(track, stream);
        });
      }
    } catch (error) {
      console.error('Error accessing webcam:', error);
      alert('Failed to access webcam: ' + error.message);
    } finally {
      isGettingMediaRef.current = false;
    }
  };

  const generateRandomRoomId = () => setRoomId(Math.random().toString(36).substring(2, 10));

  const joinRoom = async () => {
    if (!roomId.trim()) return alert('Please enter a room ID');
    if (!localStream) await startWebcam();
    socketRef.current.emit('join-room', roomId);
    setConnectionStatus('connecting');
  };

  const leaveRoom = () => {
    socketRef.current.emit('leave-room', roomId);
    handlePeerDisconnect();
    setIsInRoom(false);
  };

  const handlePeerDisconnect = () => {
    setIsConnected(false);
    setRemoteStream(null);
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
  };

  const toggleMute = () => {
    localStream?.getAudioTracks().forEach(track => track.enabled = !track.enabled);
    setIsMuted(!isMuted);
  };

  const toggleVideo = () => {
    localStream?.getVideoTracks().forEach(track => track.enabled = !track.enabled);
    setIsVideoOff(!isVideoOff);
  };

  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
        const screenTrack = screenStream.getVideoTracks()[0];
        const sender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video');
        sender?.replaceTrack(screenTrack);
        localVideoRef.current.srcObject = screenStream;
        screenTrack.onended = stopScreenShare;
        setIsScreenSharing(true);
      } else stopScreenShare();
    } catch (error) {
      if (error.name !== 'NotAllowedError') alert('Failed to share screen: ' + error.message);
    }
  };

  const stopScreenShare = () => {
    const videoTrack = originalStreamRef.current?.getVideoTracks()[0];
    const sender = peerConnectionRef.current?.getSenders().find(s => s.track?.kind === 'video');
    sender?.replaceTrack(videoTrack);
    if (localVideoRef.current) localVideoRef.current.srcObject = originalStreamRef.current;
    setIsScreenSharing(false);
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    alert('Room ID copied!');
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500';
      case 'failed': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 flex items-center justify-center gap-3">
            <Video className="w-8 h-8 md:w-10 md:h-10" /> WebRTC Video Call
          </h1>
          <div className="flex items-center justify-center gap-2">
            <div className={`w-3 h-3 rounded-full ${getStatusColor()}`}></div>
            <span className="text-gray-300 capitalize">{connectionStatus}</span>
          </div>
          {isInRoom && (
            <div className="mt-2 text-gray-300 flex flex-wrap justify-center gap-2">
              <span className="font-medium">Room ID:</span>
              <span className="font-bold">{roomId}</span>
              <button onClick={copyRoomId} className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm">Copy</button>
            </div>
          )}
        </div>

     
        {!isInRoom && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 md:p-6 mb-6 border border-white/20">
            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="text"
                placeholder="Enter Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="flex-1 px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button onClick={generateRandomRoomId} className="px-4 md:px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">Generate Room ID</button>
              <button
                onClick={localStream ? joinRoom : startWebcam}
                className={`px-4 md:px-6 py-3 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${localStream ? 'bg-green-600 hover:bg-green-700' : 'bg-purple-600 hover:bg-purple-700'}`}
              >
                {localStream ? <Users className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                {localStream ? 'Join Room' : 'Start Webcam'}
              </button>
            </div>
          </div>
        )}

        {/* Video grids */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-6">
          {/* Local Video */}
          <div className="relative bg-black rounded-2xl overflow-hidden shadow-2xl aspect-video">
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            <div className="absolute bottom-2 md:bottom-4 left-2 md:left-4 bg-black/60 backdrop-blur-sm px-2 md:px-3 py-1 rounded-lg">
              <span className="text-white font-medium">You</span>
            </div>
            {isVideoOff && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                <VideoOff className="w-16 h-16 text-gray-400" />
              </div>
            )}
          </div>

          {/* Remote Video */}
          <div className="relative bg-black rounded-2xl overflow-hidden shadow-2xl aspect-video">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            {!isConnected && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900 text-center p-4">
                <Users className="w-16 h-16 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-400 font-medium">Waiting for peer...</p>
                <p className="text-gray-500 text-sm mt-1">{isInRoom ? 'Share room ID with someone to connect' : 'Join a room to start'}</p>
              </div>
            )}
            {isConnected && (
              <div className="absolute bottom-2 md:bottom-4 left-2 md:left-4 bg-black/60 backdrop-blur-sm px-2 md:px-3 py-1 rounded-lg">
                <span className="text-white font-medium">Peer</span>
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        {localStream && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 md:p-6 border border-white/20">
            <div className="flex flex-wrap justify-center gap-3 md:gap-4">
              <button onClick={toggleMute} className={`px-4 md:px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'} text-white`}>
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />} {isMuted ? 'Unmute' : 'Mute'}
              </button>
              <button onClick={toggleVideo} className={`px-4 md:px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'} text-white`}>
                {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />} {isVideoOff ? 'Start Video' : 'Stop Video'}
              </button>
              <button onClick={toggleScreenShare} className={`px-4 md:px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${isScreenSharing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/20 hover:bg-white/30'} text-white`}>
                <Monitor className="w-5 h-5" /> {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
              </button>
              {isInRoom && (
                <button onClick={leaveRoom} className="px-4 md:px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all flex items-center gap-2">
                  <PhoneOff className="w-5 h-5" /> Leave Room
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoCallApp;
