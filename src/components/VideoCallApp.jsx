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
    socketRef.current = io(SOCKET_SERVER);

    socketRef.current.on('connect', () => {
      console.log('Connected to signaling server');
      setConnectionStatus('connected');
    });

    socketRef.current.on('disconnect', () => {
      console.log('Disconnected from signaling server');
      setConnectionStatus('disconnected');
    });

    socketRef.current.on('joined-room', (room) => {
      console.log('Joined room:', room, 'Current roomId:', roomId);
      setIsInRoom(true);
    });

    socketRef.current.on('room-full', () => {
      alert('Room is full! Maximum 2 users allowed.');
      setConnectionStatus('disconnected');
    });

    socketRef.current.on('other-user', (userId) => {
      console.log('Other user in room:', userId);
      isInitiatorRef.current = true; // the second peer becomes the offerer
      createPeerConnection(userId);
      createOffer(userId);
    });

    socketRef.current.on('user-joined', (userId) => {
      console.log('User joined:', userId);
      isInitiatorRef.current = false; // the first peer answers
      createPeerConnection(userId);
    });

    socketRef.current.on('offer', async ({ offer, from }) => {
      console.log('Received offer from:', from);
      if (!peerConnectionRef.current) {
        createPeerConnection(from);
      }
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);
      socketRef.current.emit('answer', { answer, to: from });
    });

    socketRef.current.on('answer', async ({ answer, from }) => {
      console.log('Received answer from:', from);
      try {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (e) {
        console.warn('Error setting remote answer, retrying once:', e);
        // Retry path: sometimes negotiation races; try rollback then set again
        try {
          if (peerConnectionRef.current.signalingState !== 'stable') {
            await peerConnectionRef.current.setLocalDescription({ type: 'rollback' });
          }
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (e2) {
          console.error('Failed to apply remote answer after retry:', e2);
        }
      }
    });

    socketRef.current.on('ice-candidate', async ({ candidate, from }) => {
      console.log('Received ICE candidate from:', from);
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
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
    const peerConnection = new RTCPeerConnection(iceServers);
    peerConnectionRef.current = peerConnection;

    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }

    peerConnection.ontrack = (event) => {
      const stream = event.streams[0];
      const trackKinds = stream.getTracks().map(t => t.kind).join(', ');
      console.log('Received remote track(s):', trackKinds);
      setRemoteStream(stream);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        const p = remoteVideoRef.current.play?.();
        if (p && typeof p.then === 'function') {
          p.catch((e) => console.warn('Remote video play() blocked until user interaction:', e));
        }
      }
      setIsConnected(true);
      setConnectionStatus('connected');
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          to: userId,
        });
      }
    };

    peerConnection.onicecandidateerror = (e) => {
      console.warn('ICE candidate error:', e);
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', peerConnection.iceConnectionState);
    };

    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.connectionState);
      setConnectionStatus(peerConnection.connectionState);

      if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
        handlePeerDisconnect();
      }
    };

    peerConnection.onnegotiationneeded = async () => {
      console.log('negotiationneeded, initiator:', isInitiatorRef.current);
      if (isInitiatorRef.current && peerConnectionRef.current) {
        try {
          await createOffer(userId);
        } catch (e) {
          console.warn('Error during negotiationneeded offer:', e);
        }
      }
    };

    // Chat data channel removed

    return peerConnection;
  };

  // Chat feature removed

  const createOffer = async (userId) => {
    try {
      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);
      socketRef.current.emit('offer', { offer, to: userId });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  };

  const startWebcam = async () => {
    if (isGettingMediaRef.current) return;
    isGettingMediaRef.current = true;
    try {
      // Release any existing tracks to free the device
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }

      const baseConstraints = { video: { width: 1280, height: 720 }, audio: true };
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(baseConstraints);
      } catch (err) {
        // Handle device busy case with fallbacks
        if (err.name === 'NotReadableError') {
          console.warn('NotReadableError: device busy, trying without audio...');
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
          } catch (_) {
            console.warn('Retry with specific deviceIds');
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cam = devices.find(d => d.kind === 'videoinput');
            const mic = devices.find(d => d.kind === 'audioinput');
            if (cam || mic) {
              stream = await navigator.mediaDevices.getUserMedia({
                video: cam ? { deviceId: { exact: cam.deviceId } } : false,
                audio: mic ? { deviceId: { exact: mic.deviceId } } : false,
              });
            } else {
              throw err;
            }
          }
        } else {
          throw err;
        }
      }

      setLocalStream(stream);
      originalStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      if (peerConnectionRef.current) {
        // If already connected, publish new tracks
        stream.getTracks().forEach(track => {
          const sender = peerConnectionRef.current
            .getSenders()
            .find(s => s.track && s.track.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track);
          } else {
            peerConnectionRef.current.addTrack(track, stream);
          }
        });
      }
    } catch (error) {
      console.error('Error accessing webcam:', error);
      if (error.name === 'NotAllowedError') {
        alert('Camera/Microphone access denied. Please allow permissions and try again.\n\nClick the camera icon in your browser\'s address bar to change permissions.');
      } else if (error.name === 'NotFoundError') {
        alert('No camera or microphone found. Please connect a device and try again.');
      } else if (error.name === 'NotReadableError') {
        alert('Your camera or microphone seems to be in use by another application.\n\nClose apps like Zoom/Teams/Meet/OBS, then try again. On Windows: Settings > Privacy & security > Camera/Microphone to check access.');
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
  };

  const joinRoom = () => {
    if (!roomId.trim()) {
      alert('Please enter a room ID');
      return;
    }

    console.log('Joining room with ID:', roomId);
    socketRef.current.emit('join-room', roomId);
    setConnectionStatus('connecting');
  };

  const leaveRoom = () => {
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
    setIsConnected(false);
    setRemoteStream(null);
    setConnectionStatus('disconnected');

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
          audio: false,
        });

        const screenTrack = screenStream.getVideoTracks()[0];

        if (peerConnectionRef.current) {
          const sender = peerConnectionRef.current
            .getSenders()
            .find(s => s.track && s.track.kind === 'video');

          if (sender) {
            sender.replaceTrack(screenTrack);
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
      console.error('Error sharing screen:', error);
      if (error.name === 'NotAllowedError') {
        console.log('Screen share cancelled by user');
      } else {
        alert('Failed to share screen: ' + error.message);
      }
    }
  };

  const stopScreenShare = () => {
    if (originalStreamRef.current && peerConnectionRef.current) {
      const videoTrack = originalStreamRef.current.getVideoTracks()[0];
      const sender = peerConnectionRef.current
        .getSenders()
        .find(s => s.track && s.track.kind === 'video');

      if (sender) {
        sender.replaceTrack(videoTrack);
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = originalStreamRef.current;
      }
    }
    setIsScreenSharing(false);
  };

  // Chat send removed

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
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center justify-center gap-3">
            <Video className="w-10 h-10" />
            WebRTC Video Call
          </h1>
          <div className="flex items-center justify-center gap-2">
            <div className={`w-3 h-3 rounded-full ${getStatusColor()}`}></div>
            <span className="text-gray-300 capitalize">{connectionStatus}</span>
          </div>
          {/* Display Room ID when in a room */}
          {isInRoom && (
            <div className="mt-2 text-gray-300">
              <span className="font-medium">Room ID: </span>
              <span className="font-bold">{roomId || 'Not set'}</span>
              <button
                onClick={copyRoomId}
                className="ml-3 px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm"
                title="Copy Room ID"
              >
                Copy
              </button>
            </div>
          )}
        </div>

        {/* Room Controls */}
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
              {!localStream ? (
                <button
                  onClick={startWebcam}
                  className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Video className="w-5 h-5" />
                  Start Webcam
                </button>
              ) : (
                <button
                  onClick={joinRoom}
                  className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Users className="w-5 h-5" />
                  Join Room
                </button>
              )}
            </div>
          </div>
        )}

        {/* Video Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Local Video */}
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

          {/* Remote Video */}
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

        {/* Controls */}
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
