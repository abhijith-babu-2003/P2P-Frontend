import React, { useState, useRef, useEffect } from 'react';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Monitor, Users, Copy, Check } from 'lucide-react';
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
  const [copied, setCopied] = useState(false);

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
        await peerConnectionRef.current.setRemoteDescription(offer);
        const answer = await peerConnectionRef.current.createAnswer();
        await peerConnectionRef.current.setLocalDescription(answer);
        socketRef.current.emit('answer', { answer, to: from });
      } catch (error) {
        console.error('Error handling offer:', error);
      }
    });

    socketRef.current.on('answer', async ({ answer }) => {
      if (peerConnectionRef.current.signalingState === 'have-local-offer') {
        await peerConnectionRef.current.setRemoteDescription(answer);
      }
    });

    socketRef.current.on('ice-candidate', async ({ candidate }) => {
      if (peerConnectionRef.current) {
        try { await peerConnectionRef.current.addIceCandidate(candidate); }
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
    const offer = await peerConnectionRef.current.createOffer();
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
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // Signal-bar status indicator instead of a plain dot — reads like a
  // real connection-quality meter rather than a decorative badge.
  const statusMeta = {
    connected: { bars: 3, label: 'Connected', color: '#2DD4BF' },
    connecting: { bars: 2, label: 'Connecting', color: '#F5A524' },
    failed: { bars: 0, label: 'Connection failed', color: '#F0575B' },
    disconnected: { bars: 0, label: 'Disconnected', color: '#5B6472' },
  };
  const currentStatus = statusMeta[connectionStatus] || statusMeta.disconnected;

  const SignalBars = ({ active, color }) => (
    <div className="flex items-end gap-[2px] h-3.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-sm transition-colors"
          style={{
            height: `${(i + 1) * 4 + 2}px`,
            backgroundColor: i < active ? color : '#333B47',
          }}
        />
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0B0D12] p-4 md:p-6 font-sans" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="max-w-6xl mx-auto">

        {/* Top bar */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#14B8A6]/15 flex items-center justify-center">
              <Video className="w-4 h-4 text-[#2DD4BF]" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-[#E8EAED] leading-none">Classroom Session</h1>
              <p className="text-[12px] text-[#5B6472] mt-1 leading-none">Live video call</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-[#161A21] border border-[#252B35] rounded-full pl-3 pr-3.5 py-1.5">
            <SignalBars active={currentStatus.bars} color={currentStatus.color} />
            <span className="text-[12px] font-medium" style={{ color: currentStatus.color }}>
              {currentStatus.label}
            </span>
          </div>
        </div>

        {/* Join panel */}
        {!isInRoom && (
          <div className="bg-[#12151B] rounded-2xl p-5 md:p-6 mb-6 border border-[#22262F]">
            <p className="text-[13px] text-[#5B6472] mb-3 tracking-wide uppercase font-medium">Session code</p>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="text"
                placeholder="Enter session code"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="flex-1 px-4 py-3 bg-[#0B0D12] border border-[#252B35] rounded-lg text-[#E8EAED] placeholder-[#4A5261] font-mono tracking-wide text-sm focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/50 focus:border-[#14B8A6]/50"
              />
              <button
                onClick={generateRandomRoomId}
                className="px-4 md:px-5 py-3 bg-[#1A1F27] hover:bg-[#20262F] border border-[#252B35] text-[#C7CCD4] rounded-lg font-medium text-sm transition-colors"
              >
                Generate code
              </button>
              <button
                onClick={localStream ? joinRoom : startWebcam}
                className="px-4 md:px-6 py-3 bg-[#14B8A6] hover:bg-[#0F9C8D] text-[#04120F] rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {localStream ? <Users className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                {localStream ? 'Join session' : 'Start camera'}
              </button>
            </div>
          </div>
        )}

        {isInRoom && (
          <div className="flex items-center gap-2 mb-4 text-[13px]">
            <span className="text-[#5B6472]">Session code</span>
            <span className="font-mono text-[#C7CCD4] bg-[#161A21] border border-[#252B35] px-2.5 py-1 rounded-md tracking-wide">{roomId}</span>
            <button
              onClick={copyRoomId}
              className="flex items-center gap-1 text-[#5B6472] hover:text-[#C7CCD4] transition-colors px-1.5 py-1"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#2DD4BF]" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}

        {/* Video grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">

          <div className="relative bg-[#0E1015] rounded-xl overflow-hidden border border-[#22262F] aspect-video">
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-[#0B0D12]/80 backdrop-blur-sm px-2.5 py-1 rounded-md border border-white/5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2DD4BF]" />
              <span className="text-[#E8EAED] text-[12px] font-medium">You</span>
            </div>
            {isMuted && (
              <div className="absolute top-3 left-3 bg-[#F0575B] p-1.5 rounded-md">
                <MicOff className="w-3.5 h-3.5 text-white" />
              </div>
            )}
            {isVideoOff && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#12151B]">
                <VideoOff className="w-10 h-10 text-[#333B47]" />
              </div>
            )}
          </div>

          <div className="relative bg-[#0E1015] rounded-xl overflow-hidden border border-[#22262F] aspect-video">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            {!isConnected && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                <div className="w-12 h-12 rounded-full bg-[#161A21] border border-[#22262F] flex items-center justify-center mb-3">
                  <Users className="w-5 h-5 text-[#5B6472]" />
                </div>
                <p className="text-[#C7CCD4] font-medium text-[13px]">Waiting for peer</p>
                <p className="text-[#4A5261] text-[12px] mt-1">
                  {isInRoom ? 'Share the session code to connect' : 'Join a session to start'}
                </p>
              </div>
            )}
            {isConnected && (
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-[#0B0D12]/80 backdrop-blur-sm px-2.5 py-1 rounded-md border border-white/5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2DD4BF]" />
                <span className="text-[#E8EAED] text-[12px] font-medium">Peer</span>
              </div>
            )}
          </div>
        </div>

        {/* Floating control dock */}
        {localStream && (
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 bg-[#12151B]/95 backdrop-blur-md border border-[#22262F] rounded-full px-3 py-2.5 shadow-2xl">
              <button
                onClick={toggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                  isMuted ? 'bg-[#F0575B] hover:bg-[#D94A4E]' : 'bg-[#1A1F27] hover:bg-[#20262F]'
                }`}
              >
                {isMuted ? <MicOff className="w-4.5 h-4.5 text-white" /> : <Mic className="w-4.5 h-4.5 text-[#C7CCD4]" />}
              </button>

              <button
                onClick={toggleVideo}
                title={isVideoOff ? 'Start video' : 'Stop video'}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                  isVideoOff ? 'bg-[#F0575B] hover:bg-[#D94A4E]' : 'bg-[#1A1F27] hover:bg-[#20262F]'
                }`}
              >
                {isVideoOff ? <VideoOff className="w-4.5 h-4.5 text-white" /> : <Video className="w-4.5 h-4.5 text-[#C7CCD4]" />}
              </button>

              <button
                onClick={toggleScreenShare}
                title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                  isScreenSharing ? 'bg-[#14B8A6] hover:bg-[#0F9C8D]' : 'bg-[#1A1F27] hover:bg-[#20262F]'
                }`}
              >
                <Monitor className={`w-4.5 h-4.5 ${isScreenSharing ? 'text-[#04120F]' : 'text-[#C7CCD4]'}`} />
              </button>

              {isInRoom && (
                <>
                  <div className="w-px h-6 bg-[#22262F] mx-1" />
                  <button
                    onClick={leaveRoom}
                    title="Leave session"
                    className="h-11 px-5 rounded-full bg-[#F0575B] hover:bg-[#D94A4E] flex items-center gap-2 transition-colors"
                  >
                    <PhoneOff className="w-4 h-4 text-white" />
                    <span className="text-white text-[13px] font-medium">Leave</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoCallApp;