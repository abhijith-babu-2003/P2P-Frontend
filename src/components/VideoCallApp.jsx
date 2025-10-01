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
  const iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

  useEffect(() => {
    socketRef.current = io(SOCKET_SERVER, { transports: ['websocket', 'polling'] });

    const handleDisconnect = () => setConnectionStatus('disconnected');

    socketRef.current.on('connect', () => setConnectionStatus('connected'));
    socketRef.current.on('disconnect', handleDisconnect);
    socketRef.current.on('joined-room', () => setIsInRoom(true));
    socketRef.current.on('room-full', () => { alert('Room is full!'); handleDisconnect(); setIsInRoom(false); });

    socketRef.current.on('other-user', (id) => { isInitiatorRef.current = true; initPeer(id, true); });
    socketRef.current.on('user-joined', (id) => { isInitiatorRef.current = false; initPeer(id); });
    socketRef.current.on('offer', handleOffer);
    socketRef.current.on('answer', handleAnswer);
    socketRef.current.on('ice-candidate', handleCandidate);
    socketRef.current.on('user-left', handlePeerDisconnect);

    return () => {
      socketRef.current.disconnect();
      localStream?.getTracks().forEach(t => t.stop());
      peerConnectionRef.current?.close();
    };
  }, []);

  const initPeer = (userId, createOfferFlag = false) => {
    if (peerConnectionRef.current) peerConnectionRef.current.close();

    const pc = new RTCPeerConnection(iceServers);
    peerConnectionRef.current = pc;

    const stream = localStream || originalStreamRef.current;
    stream?.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = ({ streams: [s] }) => { setRemoteStream(s); setIsConnected(true); remoteVideoRef.current.srcObject = s; };
    pc.onicecandidate = e => e.candidate && socketRef.current.emit('ice-candidate', { candidate: e.candidate, to: userId });
    pc.onconnectionstatechange = () => {
      setConnectionStatus(pc.connectionState);
      if (['disconnected', 'failed'].includes(pc.connectionState)) handlePeerDisconnect();
    };
    pc.onnegotiationneeded = () => { if (isInitiatorRef.current) createOffer(userId); };

    if (createOfferFlag) setTimeout(() => createOffer(userId), 100);
  };

  const createOffer = async (userId) => {
    if (!peerConnectionRef.current) return;
    const offer = await peerConnectionRef.current.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await peerConnectionRef.current.setLocalDescription(offer);
    socketRef.current.emit('offer', { offer, to: userId });
  };

  const handleOffer = async ({ offer, from }) => {
    if (!peerConnectionRef.current) initPeer(from);
    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnectionRef.current.createAnswer();
    await peerConnectionRef.current.setLocalDescription(answer);
    socketRef.current.emit('answer', { answer, to: from });
  };

  const handleAnswer = async ({ answer }) => {
    if (peerConnectionRef.current.signalingState === 'have-local-offer') {
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
    }
  };

  const handleCandidate = async ({ candidate }) => {
    await peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
  };

  const handlePeerDisconnect = () => {
    setIsConnected(false);
    setRemoteStream(null);
    remoteVideoRef.current.srcObject = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
  };

  const getMedia = async (constraints) => {
    if (isGettingMediaRef.current) return;
    isGettingMediaRef.current = true;
    try {
      localStream?.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);
      originalStreamRef.current = stream;
      localVideoRef.current.srcObject = stream;

      peerConnectionRef.current?.getSenders().forEach(sender => {
        const track = stream.getTracks().find(t => t.kind === sender.track.kind);
        track && sender.replaceTrack(track);
      });
    } catch (e) {
      console.error('Media error:', e);
      alert('Failed to access media: ' + e.message);
    } finally {
      isGettingMediaRef.current = false;
    }
  };

  const startWebcam = () => getMedia({ video: { width: 1280, height: 720 }, audio: true });
  const toggleTrack = (kind, stateSetter) => {
    localStream?.getTracks().filter(t => t.kind === kind).forEach(t => t.enabled = !t.enabled);
    stateSetter(prev => !prev);
  };
  const toggleScreenShare = async () => {
    if (isScreenSharing) return stopScreenShare();
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = screenStream.getVideoTracks()[0];
      const sender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video');
      sender && sender.replaceTrack(screenTrack);
      localVideoRef.current.srcObject = screenStream;
      screenTrack.onended = stopScreenShare;
      setIsScreenSharing(true);
    } catch (e) { console.error('Screen share error:', e); }
  };
  const stopScreenShare = () => {
    const videoTrack = originalStreamRef.current?.getVideoTracks()[0];
    const sender = peerConnectionRef.current?.getSenders().find(s => s.track?.kind === 'video');
    sender && videoTrack && sender.replaceTrack(videoTrack);
    localVideoRef.current.srcObject = originalStreamRef.current;
    setIsScreenSharing(false);
  };
  const joinRoom = async () => {
    if (!roomId.trim()) return alert('Enter Room ID');
    if (!localStream) await startWebcam();
    socketRef.current.emit('join-room', roomId);
    setConnectionStatus('connecting');
  };
  const leaveRoom = () => {
    socketRef.current.emit('leave-room', roomId);
    handlePeerDisconnect();
    setIsInRoom(false);
    setConnectionStatus('disconnected');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
     
        <div className="text-center mb-4 sm:mb-6">
          <h1 className="text-3xl sm:text-4xl font-bold text-white flex items-center justify-center gap-2 sm:gap-3">
            <Video className="w-8 h-8 sm:w-10 sm:h-10" />  Video Call
          </h1>
          <div className="flex items-center justify-center gap-2 mt-1 sm:mt-2">
            <div className={`w-3 h-3 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500' : connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-gray-500'}`}></div>
            <span className="text-gray-300 capitalize text-sm sm:text-base">{connectionStatus}</span>
          </div>
        </div>

     
        {!isInRoom && (
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4 sm:mb-6 items-center justify-center">
            <input type="text" placeholder="Room ID" value={roomId} onChange={e => setRoomId(e.target.value)} className="px-3 py-2 sm:px-4 sm:py-2 rounded-lg text-white bg-white/10 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 w-full sm:w-auto" />
            <button onClick={() => setRoomId(Math.random().toString(36).substring(2, 10))} className="px-4 py-2 sm:px-6 sm:py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition w-full sm:w-auto">Generate</button>
            <button onClick={localStream ? joinRoom : startWebcam} className="px-4 py-2 sm:px-6 sm:py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition w-full sm:w-auto">{localStream ? 'Join Room' : 'Start Webcam'}</button>
          </div>
        )}

   
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          <video ref={localVideoRef} autoPlay muted className="w-full h-64 sm:h-80 md:h-96 object-cover rounded-2xl bg-black" />
          <video ref={remoteVideoRef} autoPlay className="w-full h-64 sm:h-80 md:h-96 object-cover rounded-2xl bg-black" />
        </div>

       
        {localStream && (
          <div className="mt-4 flex flex-wrap gap-3 justify-center">
            <button onClick={() => toggleTrack('audio', setIsMuted)} className={`flex items-center gap-2 px-4 py-2 rounded-lg ${isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'} text-white`}>
              {isMuted ? <MicOff /> : <Mic />} {isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button onClick={() => toggleTrack('video', setIsVideoOff)} className={`flex items-center gap-2 px-4 py-2 rounded-lg ${isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'} text-white`}>
              {isVideoOff ? <VideoOff /> : <Video />} {isVideoOff ? 'Show Video' : 'Hide Video'}
            </button>
            <button onClick={toggleScreenShare} className={`flex items-center gap-2 px-4 py-2 rounded-lg ${isScreenSharing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/20 hover:bg-white/30'} text-white`}>
              <Monitor /> {isScreenSharing ? 'Stop Share' : 'Share Screen'}
            </button>
            {isInRoom && <button onClick={leaveRoom} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white"><PhoneOff /> Leave Room</button>}
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoCallApp;
