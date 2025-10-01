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
 
    socketRef.current = io(SOCKET_SERVER, {
      transports: ['websocket', 'polling']
    });

    socketRef.current.on('connect', () => {
      console.log('Connected to signaling server');
      setConnectionStatus('connected');
    });

    socketRef.current.on('disconnect', () => {
      console.log('Disconnected from signaling server');
      setConnectionStatus('disconnected');
    });

    socketRef.current.on('joined-room', (room) => {
      console.log(' Joined room:', room);
      setIsInRoom(true);
    });

    socketRef.current.on('room-full', () => {
      alert('Room is full! Maximum 2 users allowed.');
      setConnectionStatus('disconnected');
      setIsInRoom(false);
    });

    socketRef.current.on('other-user', (userId) => {
      console.log(' Other user in room:', userId);
      isInitiatorRef.current = true;
      createPeerConnection(userId);
      setTimeout(() => {
        createOffer(userId);
      }, 100);
    });

    socketRef.current.on('user-joined', (userId) => {
      console.log(' New user joined:', userId);
      isInitiatorRef.current = false;
      createPeerConnection(userId);
    });

    socketRef.current.on('offer', async ({ offer, from }) => {
      console.log(' Received offer from:', from);
      if (!peerConnectionRef.current) {
        console.log('Creating peer connection to handle offer');
        createPeerConnection(from);
      }
      
      try {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer));
        console.log(' Remote description set (offer)');
        
        const answer = await peerConnectionRef.current.createAnswer();
        await peerConnectionRef.current.setLocalDescription(answer);
        console.log(' Local description set (answer)');
        
        socketRef.current.emit('answer', { answer, to: from });
        console.log(' Answer sent to:', from);
      } catch (error) {
        console.error(' Error handling offer:', error);
      }
    });

    socketRef.current.on('answer', async ({ answer, from }) => {
      console.log('Received answer from:', from);
      try {
        if (peerConnectionRef.current.signalingState === 'have-local-offer') {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
          console.log(' Remote description set (answer)');
        } else {
          console.warn(' Unexpected signaling state:', peerConnectionRef.current.signalingState);
        }
      } catch (e) {
        console.error('Error setting remote answer:', e);
      }
    });

    socketRef.current.on('ice-candidate', async ({ candidate, from }) => {
      console.log(' Received ICE candidate from:', from);
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          console.log(' ICE candidate added');
        } catch (error) {
          console.error(' Error adding ICE candidate:', error);
        }
      }
    });

    socketRef.current.on('user-left', () => {
      console.log('User left the room');
      handlePeerDisconnect();
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, []);

  const createPeerConnection = (userId) => {
    console.log('Creating peer connection for user:', userId);
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    const peerConnection = new RTCPeerConnection(iceServers);
    peerConnectionRef.current = peerConnection;


    const streamToUse = localStream || originalStreamRef.current;
    if (streamToUse) {
      const tracks = streamToUse.getTracks();
      console.log(` Adding ${tracks.length} local tracks to peer connection`);
      
      tracks.forEach(track => {
        console.log(`Adding ${track.kind} track (enabled: ${track.enabled})`);
        peerConnection.addTrack(track, streamToUse);
      });
    } else {
      console.warn(' No local stream available when creating peer connection');
    }

  
    peerConnection.ontrack = (event) => {
      const stream = event.streams[0];
      console.log('  Stream ID:', stream.id);
      console.log('  Tracks:', stream.getTracks().map(t => `${t.kind} (${t.enabled ? 'enabled' : 'disabled'})`).join(', '));
      
      setRemoteStream(stream);
      setIsConnected(true);
      setConnectionStatus('connected');
      
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        
        remoteVideoRef.current.onloadedmetadata = () => {
          remoteVideoRef.current.play()
            .then(() => console.log(' Remote video playing'))
            .catch(e => console.warn(' Remote video play blocked:', e.message));
        };
      }
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(' Sending ICE candidate to:', userId);
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          to: userId,
        });
      } else {
        console.log(' All ICE candidates sent');
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log(' ICE connection state:', peerConnection.iceConnectionState);
    };

    peerConnection.onconnectionstatechange = () => {
      console.log(' Connection state:', peerConnection.connectionState);
      setConnectionStatus(peerConnection.connectionState);

      if (peerConnection.connectionState === 'connected') {
        console.log(' PEER CONNECTION ESTABLISHED!');
      }

      if (peerConnection.connectionState === 'disconnected' || 
          peerConnection.connectionState === 'failed') {
        handlePeerDisconnect();
      }
    }

    peerConnection.onnegotiationneeded = async () => {
      console.log(' Negotiation needed (initiator:', isInitiatorRef.current, ')');
      if (isInitiatorRef.current && peerConnectionRef.current) {
        try {
          await createOffer(userId);
        } catch (e) {
          console.error(' Error during negotiation:', e);
        }
      }
    };

    return peerConnection;
  };

  const createOffer = async (userId) => {
    if (!peerConnectionRef.current) {
      console.error(' Cannot create offer: no peer connection');
      return;
    }

    try {
      console.log(' Creating offer for user:', userId);
      const offer = await peerConnectionRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await peerConnectionRef.current.setLocalDescription(offer);
      
      console.log('Sending offer to:', userId);
      socketRef.current.emit('offer', { offer, to: userId });
      console.log(' Offer sent successfully');
    } catch (error) {
      console.error('❌ Error creating offer:', error);
    }
  };

  const startWebcam = async () => {
    if (isGettingMediaRef.current) {
      console.log(' Already getting media, please wait...');
      return;
    }
    
    isGettingMediaRef.current = true;
    
    try {
      if (localStream) {
        console.log(' Stopping existing stream');
        localStream.getTracks().forEach(t => t.stop());
      }

      const constraints = { 
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 } 
        }, 
        audio: true 
      };
      
      console.log(' Requesting media devices...');
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      console.log(' Got media stream with tracks:', 
        stream.getTracks().map(t => t.kind).join(', '));
      
      setLocalStream(stream);
      originalStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        console.log(' Local stream set to video element');
      }

      if (peerConnectionRef.current) {
        console.log(' Adding tracks to existing peer connection');
        stream.getTracks().forEach(track => {
          const sender = peerConnectionRef.current
            .getSenders()
            .find(s => s.track && s.track.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track);
            console.log(' Replaced', track.kind, 'track');
          } else {
            peerConnectionRef.current.addTrack(track, stream);
            console.log(' Added', track.kind, 'track');
          }
        });
      }
    } catch (error) {
      console.error('❌ Error accessing webcam:', error);
      if (error.name === 'NotAllowedError') {
        alert('Camera/Microphone access denied. Please allow permissions in your browser settings.');
      } else if (error.name === 'NotFoundError') {
        alert('No camera or microphone found. Please connect a device.');
      } else if (error.name === 'NotReadableError') {
        alert('Camera/microphone is in use by another application. Please close other apps and try again.');
      } else {
        alert('Failed to access webcam: ' + error.message);
      }
    } finally {
      isGettingMediaRef.current = false;
    }
  };

  const generateRandomRoomId = () => {
    const randomId = Math.random().toString(36).substring(2, 10);
    setRoomId(randomId);
    console.log(' Generated room ID:', randomId);
  };

  const joinRoom = async () => {
    if (!roomId.trim()) {
      alert('Please enter a room ID');
      return;
    }

    if (!localStream) {
      console.log(' Starting webcam before joining...');
      await startWebcam();
    }

    console.log('Joining room:', roomId);
    socketRef.current.emit('join-room', roomId);
    setConnectionStatus('connecting');
  };

  const leaveRoom = () => {
    console.log(' Leaving room:', roomId);
    
    if (roomId) {
      socketRef.current.emit('leave-room', roomId);
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    setIsInRoom(false);
    setIsConnected(false);
    setRemoteStream(null);
    setConnectionStatus('disconnected');

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  const handlePeerDisconnect = () => {
    console.log(' Handling peer disconnect');
    setIsConnected(false);
    setRemoteStream(null);

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
      console.log(isMuted ? '🔊 Unmuted' : '🔇 Muted');
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
      console.log(isVideoOff ? '📹 Video on' : '📹 Video off');
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        console.log(' Starting screen share...');
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: false,
        });

        const screenTrack = screenStream.getVideoTracks()[0];

        if (peerConnectionRef.current) {
          const sender = peerConnectionRef.current
            .getSenders()
            .find(s => s.track && s.track.kind === 'video');

          if (sender) {
            await sender.replaceTrack(screenTrack);
          }
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        screenTrack.onended = () => {
          stopScreenShare();
        };

        setIsScreenSharing(true);
      } else {
        stopScreenShare();
      }
    } catch (error) {
      console.error(' Error sharing screen:', error);
      if (error.name !== 'NotAllowedError') {
        alert('Failed to share screen: ' + error.message);
      }
    }
  };

  const stopScreenShare = () => {
    console.log('Stopping screen share');
    if (originalStreamRef.current && peerConnectionRef.current) {
      const videoTrack = originalStreamRef.current.getVideoTracks()[0];
      const sender = peerConnectionRef.current
        .getSenders()
        .find(s => s.track && s.track.kind === 'video');

      if (sender && videoTrack) {
        sender.replaceTrack(videoTrack);
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = originalStreamRef.current;
      }
    }
    setIsScreenSharing(false);
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    alert('Room ID copied to clipboard!');
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
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center justify-center gap-3">
            <Video className="w-10 h-10" />
            WebRTC Video Call
          </h1>
          <div className="flex items-center justify-center gap-2">
            <div className={`w-3 h-3 rounded-full ${getStatusColor()}`}></div>
            <span className="text-gray-300 capitalize">{connectionStatus}</span>
          </div>
          {isInRoom && (
            <div className="mt-2 text-gray-300">
              <span className="font-medium">Room ID: </span>
              <span className="font-bold">{roomId}</span>
              <button
                onClick={copyRoomId}
                className="ml-3 px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm"
              >
                Copy
              </button>
            </div>
          )}
        </div>

        {!isInRoom && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6 border border-white/20">
            <div className="flex flex-col md:flex-row gap-4">
              <input
                type="text"
                placeholder="Enter Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="flex-1 px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={generateRandomRoomId}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Generate Room ID
              </button>
              <button
                onClick={localStream ? joinRoom : startWebcam}
                className={`px-6 py-3 ${localStream ? 'bg-green-600 hover:bg-green-700' : 'bg-purple-600 hover:bg-purple-700'} text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2`}
              >
                {localStream ? <Users className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                {localStream ? 'Join Room' : 'Start Webcam'}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="relative bg-black rounded-2xl overflow-hidden shadow-2xl aspect-video">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm px-3 py-1 rounded-lg">
              <span className="text-white font-medium">You</span>
            </div>
            {isVideoOff && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                <VideoOff className="w-16 h-16 text-gray-400" />
              </div>
            )}
          </div>

          <div className="relative bg-black rounded-2xl overflow-hidden shadow-2xl aspect-video">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            {!isConnected && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
                <div className="text-center">
                  <Users className="w-16 h-16 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-400 font-medium">Waiting for peer...</p>
                  <p className="text-gray-500 text-sm mt-2">
                    {isInRoom ? 'Share room ID with someone to connect' : 'Join a room to start'}
                  </p>
                </div>
              </div>
            )}
            {isConnected && (
              <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm px-3 py-1 rounded-lg">
                <span className="text-white font-medium">Peer</span>
              </div>
            )}
          </div>
        </div>

        {localStream && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
            <div className="flex flex-wrap justify-center gap-4">
              <button
                onClick={toggleMute}
                className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${
                  isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'
                } text-white`}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                {isMuted ? 'Unmute' : 'Mute'}
              </button>

              <button
                onClick={toggleVideo}
                className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${
                  isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'
                } text-white`}
              >
                {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                {isVideoOff ? 'Start Video' : 'Stop Video'}
              </button>

              <button
                onClick={toggleScreenShare}
                className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${
                  isScreenSharing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/20 hover:bg-white/30'
                } text-white`}
              >
                <Monitor className="w-5 h-5" />
                {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
              </button>

              {isInRoom && (
                <button
                  onClick={leaveRoom}
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all flex items-center gap-2"
                >
                  <PhoneOff className="w-5 h-5" />
                  Leave Room
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