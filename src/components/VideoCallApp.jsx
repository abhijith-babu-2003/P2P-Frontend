import React, { useState, useRef, useEffect } from 'react';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Monitor, Users } from 'lucide-react';

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
  const remoteUserIdRef = useRef(null);
  const makingOfferRef = useRef(false);
  const ignoringOfferRef = useRef(false);

  const SOCKET_SERVER = 'http://localhost:3007';
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  useEffect(() => {
    // Simple WebSocket connection simulation
    const connectSocket = () => {
      const ws = new WebSocket('ws://localhost:3007');
      
      ws.onopen = () => {
        console.log('Socket connected');
        setConnectionStatus('connected');
      };

      ws.onerror = (error) => {
        console.error('Socket error:', error);
        setConnectionStatus('disconnected');
      };

      ws.onclose = () => {
        console.log('Socket disconnected');
        setConnectionStatus('disconnected');
      };

      // Store as a simple object with emit method
      socketRef.current = {
        ws,
        emit: (event, data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event, data }));
          }
        },
        on: (event, callback) => {
          ws.onmessage = (message) => {
            try {
              const parsed = JSON.parse(message.data);
              if (parsed.event === event) {
                callback(parsed.data);
              }
            } catch (e) {
              console.error('Parse error:', e);
            }
          };
        },
        disconnect: () => ws.close()
      };
    };

    // For demo purposes, we'll simulate the connection
    console.log('App initialized');
    setConnectionStatus('ready');

    return () => {
      localStream?.getTracks().forEach(track => track.stop());
      peerConnectionRef.current?.close();
      socketRef.current?.disconnect?.();
    };
  }, []);

  const createPeerConnection = (userId) => {
    console.log('Creating peer connection with:', userId);
    
    // Close existing connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    const peerConnection = new RTCPeerConnection(iceServers);
    peerConnectionRef.current = peerConnection;
    remoteUserIdRef.current = userId;

    // Add local tracks
    const streamToUse = localStream || originalStreamRef.current;
    if (streamToUse) {
      streamToUse.getTracks().forEach(track => {
        console.log('Adding track:', track.kind);
        peerConnection.addTrack(track, streamToUse);
      });
    }

    // Handle incoming tracks
    peerConnection.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
      const stream = event.streams[0];
      setRemoteStream(stream);
      setIsConnected(true);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch(err => console.log('Play error:', err));
      }
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate');
        socketRef.current?.emit('ice-candidate', { 
          candidate: event.candidate, 
          to: userId 
        });
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.connectionState);
      setConnectionStatus(peerConnection.connectionState);
      if (peerConnection.connectionState === 'disconnected' || 
          peerConnection.connectionState === 'failed') {
        handlePeerDisconnect();
      }
    };

    // Handle negotiation
    peerConnection.onnegotiationneeded = async () => {
      console.log('Negotiation needed, isInitiator:', isInitiatorRef.current);
      if (isInitiatorRef.current && !makingOfferRef.current) {
        try {
          makingOfferRef.current = true;
          await createOffer(userId);
        } catch (error) {
          console.error('Error during negotiation:', error);
        } finally {
          makingOfferRef.current = false;
        }
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', peerConnection.iceConnectionState);
    };

    peerConnection.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', peerConnection.iceGatheringState);
    };

    return peerConnection;
  };

  const createOffer = async (userId) => {
    if (!peerConnectionRef.current) {
      console.error('No peer connection available');
      return;
    }

    try {
      console.log('Creating offer...');
      const offer = await peerConnectionRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await peerConnectionRef.current.setLocalDescription(offer);
      console.log('Sending offer');
      
      socketRef.current?.emit('offer', { offer, to: userId });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  };

  const handleOffer = async ({ offer, from }) => {
    console.log('Received offer from:', from);
    
    if (!peerConnectionRef.current) {
      createPeerConnection(from);
    }

    try {
      const offerCollision = peerConnectionRef.current.signalingState !== 'stable';
      ignoringOfferRef.current = !isInitiatorRef.current && offerCollision;

      if (ignoringOfferRef.current) {
        console.log('Ignoring offer due to collision');
        return;
      }

      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      console.log('Set remote description (offer)');

      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);
      console.log('Sending answer');

      socketRef.current?.emit('answer', { answer, to: from });
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  };

  const handleAnswer = async ({ answer, from }) => {
    console.log('Received answer from:', from);
    
    try {
      const rtcAnswer = new RTCSessionDescription(answer);
      
      // Only set remote description if we're in the correct state
      if (peerConnectionRef.current?.signalingState === 'have-local-offer') {
        await peerConnectionRef.current.setRemoteDescription(rtcAnswer);
        console.log('Set remote description (answer)');
      } else {
        console.warn('Ignoring answer - wrong state:', peerConnectionRef.current?.signalingState);
      }
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  };

  const handleIceCandidate = async ({ candidate, from }) => {
    console.log('Received ICE candidate from:', from);
    
    if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
      try {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('Added ICE candidate');
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  };

  const startWebcam = async () => {
    if (isGettingMediaRef.current) return;
    isGettingMediaRef.current = true;

    try {
      localStream?.getTracks().forEach(track => track.stop());
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720 }, 
        audio: true 
      });
      
      console.log('Got local stream');
      setLocalStream(stream);
      originalStreamRef.current = stream;
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // If we already have a peer connection, replace tracks
      if (peerConnectionRef.current) {
        stream.getTracks().forEach(track => {
          const sender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track);
          } else {
            peerConnectionRef.current.addTrack(track, stream);
          }
        });
      }
    } catch (error) {
      console.error('Error accessing webcam:', error);
      alert('Failed to access webcam: ' + error.message);
    } finally {
      isGettingMediaRef.current = false;
    }
  };

  const generateRandomRoomId = () => {
    const id = Math.random().toString(36).substring(2, 10);
    setRoomId(id);
  };

  const joinRoom = async () => {
    if (!roomId.trim()) {
      alert('Please enter a room ID');
      return;
    }
    
    if (!localStream) {
      await startWebcam();
    }
    
    console.log('Joining room:', roomId);
    setIsInRoom(true);
    setConnectionStatus('waiting');
    
    // Simulate joining - in real app, emit to socket
    // socketRef.current?.emit('join-room', roomId);
  };

  const leaveRoom = () => {
    console.log('Leaving room:', roomId);
    handlePeerDisconnect();
    setIsInRoom(false);
    setConnectionStatus('ready');
  };

  const handlePeerDisconnect = () => {
    console.log('Peer disconnected');
    setIsConnected(false);
    setRemoteStream(null);
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    remoteUserIdRef.current = null;
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { cursor: 'always' }, 
          audio: false 
        });
        
        const screenTrack = screenStream.getVideoTracks()[0];
        const sender = peerConnectionRef.current?.getSenders().find(s => s.track?.kind === 'video');
        
        if (sender) {
          await sender.replaceTrack(screenTrack);
        }
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        
        screenTrack.onended = stopScreenShare;
        setIsScreenSharing(true);
      } else {
        stopScreenShare();
      }
    } catch (error) {
      if (error.name !== 'NotAllowedError') {
        console.error('Screen share error:', error);
        alert('Failed to share screen: ' + error.message);
      }
    }
  };

  const stopScreenShare = async () => {
    const videoTrack = originalStreamRef.current?.getVideoTracks()[0];
    const sender = peerConnectionRef.current?.getSenders().find(s => s.track?.kind === 'video');
    
    if (sender && videoTrack) {
      await sender.replaceTrack(videoTrack);
    }
    
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = originalStreamRef.current;
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
      case 'waiting': return 'bg-blue-500';
      case 'ready': return 'bg-purple-500';
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
            <div className="mt-2 text-gray-300 flex flex-wrap justify-center gap-2 items-center">
              <span className="font-medium">Room ID:</span>
              <span className="font-bold">{roomId}</span>
              <button 
                onClick={copyRoomId} 
                className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition-colors"
              >
                Copy
              </button>
            </div>
          )}
        </div>

        {/* Join Room Controls */}
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
              <button 
                onClick={generateRandomRoomId} 
                className="px-4 md:px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Generate Room ID
              </button>
              <button
                onClick={localStream ? joinRoom : startWebcam}
                className={`px-4 md:px-6 py-3 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                  localStream ? 'bg-green-600 hover:bg-green-700' : 'bg-purple-600 hover:bg-purple-700'
                }`}
              >
                {localStream ? <Users className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                {localStream ? 'Join Room' : 'Start Webcam'}
              </button>
            </div>
          </div>
        )}

        {/* Video Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-6">
          {/* Local Video */}
          <div className="relative bg-black rounded-2xl overflow-hidden shadow-2xl aspect-video">
            <video 
              ref={localVideoRef} 
              autoPlay 
              muted 
              playsInline 
              className="w-full h-full object-cover" 
            />
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
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              className="w-full h-full object-cover" 
            />
            {!isConnected && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900 text-center p-4">
                <Users className="w-16 h-16 text-gray-400 mb-2" />
                <p className="text-gray-400 font-medium">Waiting for peer...</p>
                <p className="text-gray-500 text-sm mt-1">
                  {isInRoom ? 'Share room ID with someone to connect' : 'Join a room to start'}
                </p>
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
              <button 
                onClick={toggleMute} 
                className={`px-4 md:px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${
                  isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'
                } text-white`}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                {isMuted ? 'Unmute' : 'Mute'}
              </button>
              
              <button 
                onClick={toggleVideo} 
                className={`px-4 md:px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${
                  isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'
                } text-white`}
              >
                {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                {isVideoOff ? 'Start Video' : 'Stop Video'}
              </button>
              
              <button 
                onClick={toggleScreenShare} 
                className={`px-4 md:px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${
                  isScreenSharing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/20 hover:bg-white/30'
                } text-white`}
              >
                <Monitor className="w-5 h-5" />
                {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
              </button>
              
              {isInRoom && (
                <button 
                  onClick={leaveRoom} 
                  className="px-4 md:px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all flex items-center gap-2"
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