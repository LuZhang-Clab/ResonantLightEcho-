// When the page loads, execute initCapture() to start capturing the video stream
window.addEventListener('load', () => {
  initCapture();
});

// Global variables
let myLocalMediaStream; // Stores the local video stream
let socket; // WebSocket connection object
let myFriends = {}; // Stores all connected peers
let faceCanvas = {}; // Stores the face detection canvas for each peer
let happinessStates = {}; // Stores happiness states for each peer
let effectsLayer; // Reference to the effects layer
let sparkleElements = {}; // Stores sparkle elements for each peer
let sparkleTimers = {}; // Store timers for each sparkle
let fireworkInterval = null; // Store the firework interval

// Load Face-API.js models
async function loadModels() {
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('./models'), // Load face detection model
    faceapi.nets.faceLandmark68Net.loadFromUri('./models'), // Load 68 facial landmark detection model
    faceapi.nets.faceRecognitionNet.loadFromUri('./models'), // Load face recognition model
    faceapi.nets.faceExpressionNet.loadFromUri('./models') // Load facial expression detection model
  ]);
}

// STEP 5: Capture the local video stream
async function initCapture() {
  console.log('Initializing capture...');
  await loadModels(); // Load Face-API.js models

  let videoEl = document.getElementById('myVideo'); // Get the local video element
  let constraints = { audio: true, video: true }; // Set audio and video constraints

  // Request user permission to access the camera and microphone
  try {
    let stream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('Got local stream', stream); // Ensure the stream is successfully captured
    myLocalMediaStream = stream; // Store the local video stream
    videoEl.srcObject = stream; // Bind the video stream to the video element

    // Ensure video is loaded and play, then adjust canvas size and start face detection
    videoEl.onloadedmetadata = () => {
      console.log('Video metadata loaded, starting playback...');
      videoEl.play();
      adjustCanvasSize(videoEl, 'myCanvas'); // Adjust Canvas to match Video
    };
  } catch (err) {
    console.error("Error accessing webcam: ", err);
  }

  // 先设置 socket 连接
  setupSocket();
}

// Adjust canvas size to match video dimensions
function adjustCanvasSize(videoEl, canvasId) {
  let canvas = document.getElementById(canvasId);
  if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    canvas.getContext('2d', { willReadFrequently: true });
    faceapi.matchDimensions(canvas, { width: canvas.width, height: canvas.height });
    console.log(`Canvas resized to ${canvas.width}x${canvas.height}`);
  }
}

// STEP 6: Establish WebSocket connection
function setupSocket() {
  socket = io(); // Connect to the WebSocket server

  // Listen for a successful WebSocket connection
  socket.on('connect', () => {
    console.log('Client connected! My socket id:', socket.id);
    socket.emit('list'); // Request the list of online users from the server
    
    // 在 socket 连接成功后开始人脸检测
    const videoEl = document.getElementById('myVideo');
    if (videoEl && videoEl.readyState >= 2) { // 确保视频已经准备好
      startFaceDetection(videoEl, 'myCanvas');
    }
  });

  // Receive the list of online users from the server
  socket.on('listresults', data => {
    for (let i = 0; i < data.length; i++) {
      if (data[i] != socket.id) { // Connect only to other users, excluding yourself
        let theirSocketId = data[i]; // Get the peer's socket ID
        let peerConnection = setupConnection(true, theirSocketId); // Initiate a P2P connection
        myFriends[data[i]] = peerConnection; // Store the connection
      }
    }
  });

  // Listen for WebRTC signaling messages
  socket.on('signal', (to, from, data) => {
    if (to != socket.id) return; // Ensure the signal is intended for this user
    let connection = myFriends[from]; // Get the corresponding peer connection
    if (connection) {
      connection.signal(data); // If the connection exists, pass the signal
    } else {
      // If the connection does not exist, create a new P2P connection
      let theirSocketId = from;
      let peerConnection = setupConnection(false, theirSocketId);
      myFriends[from] = peerConnection; // Store the connection
      peerConnection.signal(data); // Send the signal
    }
  });

  // Listen for peer disconnection
  socket.on('peer_disconnect', (socketId) => {
    let connection = myFriends[socketId]; // Get the disconnected peer
    if (connection) {
      connection.destroy(); // Close the connection
      delete myFriends[socketId]; // Remove from myFriends list
      document.getElementById(socketId)?.remove(); // Remove the corresponding video element
      document.getElementById(`canvas_${socketId}`)?.remove(); // Remove the corresponding canvas
    }
  });
}

// STEP 7: Set up WebRTC connection
function setupConnection(initiator, theirSocketId) {
  let peerConnection = new SimplePeer({ initiator }); // Create a P2P connection

  // When the peer connection generates a signal, send it to the WebSocket server
  peerConnection.on('signal', data => {
    socket.emit('signal', theirSocketId, socket.id, data);
  });

  // Once the connection is established, send the local video stream
  peerConnection.on('connect', () => {
    console.log('Connected with:', theirSocketId);
    peerConnection.addStream(myLocalMediaStream);
  });

  // When a remote video stream is received, create a video element and play it
  peerConnection.on('stream', stream => {
    console.log('Incoming Stream from:', theirSocketId);

    let theirVideoEl = document.createElement('video');
    theirVideoEl.id = theirSocketId;
    theirVideoEl.srcObject = stream;
    theirVideoEl.width = 640;
    theirVideoEl.height = 480;
    theirVideoEl.muted = true;
    theirVideoEl.onloadedmetadata = () => theirVideoEl.play();

    document.body.appendChild(theirVideoEl);

    // Create a canvas for facial expression detection of the remote user
    let theirCanvas = document.createElement('canvas');
    theirCanvas.width = 320;  
    theirCanvas.height = 240; 
    theirCanvas.id = `canvas_${theirSocketId}`;
    theirCanvas.getContext('2d', { willReadFrequently: true });
    document.body.appendChild(theirCanvas);

    faceCanvas[theirSocketId] = theirCanvas;

    //adjustCanvasSize(theirVideoEl, theirCanvas.id); // Adjust Canvas to match Video

    startFaceDetection(theirVideoEl, theirCanvas.id); // Start facial expression detection for the remote user
  });

  return peerConnection; // Return the peer connection object
}

// Face Detection Function for both local and remote videos
function startFaceDetection(videoEl, canvasId) {
  if (!videoEl || !canvasId) {
    console.warn('Invalid parameters provided to startFaceDetection:', { videoEl, canvasId });
    return;
  }

  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.warn('Canvas element not found:', canvasId);
    return;
  }

  console.log('Starting face detection for canvas:', canvasId);

  const displaySize = { width: videoEl.width, height: videoEl.height };
  faceapi.matchDimensions(canvas, displaySize);

  if (!effectsLayer) {
    effectsLayer = document.getElementById('effects-layer');
    if (!effectsLayer) {
      console.warn('Effects layer not found');
      return;
    }
  }

  // 确保 socket 已连接
  if (!socket || !socket.id) {
    console.warn('Socket not initialized or not connected');
    return;
  }

  // 获取 peerId
  const peerId = canvasId === 'myCanvas' ? socket.id : canvasId.replace('canvas_', '');
  if (!peerId) {
    console.warn('Invalid peerId generated in startFaceDetection:', { canvasId, socketId: socket.id });
    return;
  }

  console.log('Creating fixed sparkle for peer:', peerId);
  createFixedSparkle(peerId);

  // 创建带有 willReadFrequently 属性的上下文
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  setInterval(async () => {
    if (videoEl.width === 0 || videoEl.height === 0) {
      console.warn("Skipping face detection: Video not ready.");
      return;
    }

    const detections = await faceapi
      .detectAllFaces(videoEl, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceExpressions();

    const resizedDetections = faceapi.resizeResults(detections, displaySize);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    faceapi.draw.drawDetections(canvas, resizedDetections);
    faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);
    faceapi.draw.drawFaceExpressions(canvas, resizedDetections);

    if (resizedDetections.length > 0) {
      const happiness = resizedDetections[0].expressions.happy;
      happinessStates[peerId] = happiness;
      
      // 如果用户出现但还没有白点，创建一个新的白点
      if (!sparkleElements[peerId]) {
        createFixedSparkle(peerId);
      }
      
      if (sparkleElements[peerId]) {
        const sparkle = sparkleElements[peerId];
        
        // Handle happiness state change
        if (happiness > 0.9) {
          if (!sparkle.classList.contains('happy')) {
            // Start new happy state
            sparkle.classList.add('happy');
            sparkle.classList.remove('expired');
            
            // Clear existing timer if any
            if (sparkleTimers[peerId]) {
              clearTimeout(sparkleTimers[peerId]);
            }
            
            // Set new timer
            sparkleTimers[peerId] = setTimeout(() => {
              sparkle.classList.add('expired');
              checkFireworkState();
            }, 10000);
          }
        } else {
          // Remove happy state
          sparkle.classList.remove('happy');
          if (sparkleTimers[peerId]) {
            clearTimeout(sparkleTimers[peerId]);
            delete sparkleTimers[peerId];
          }
        }
      }

      // Check firework state
      checkFireworkState();
    } else {
      // No face detected
      happinessStates[peerId] = 0;
      if (sparkleElements[peerId]) {
        const sparkle = sparkleElements[peerId];
        sparkle.classList.remove('happy');
        if (sparkleTimers[peerId]) {
          clearTimeout(sparkleTimers[peerId]);
          delete sparkleTimers[peerId];
        }
        // 移除白点
        sparkle.remove();
        delete sparkleElements[peerId];
      }
      checkFireworkState();
    }
  }, 100);
}

// Check if fireworks should be shown or stopped
function checkFireworkState() {
  // 获取所有检测到的用户
  const detectedPeers = Object.keys(happinessStates);
  
  // 如果没有检测到任何用户，停止烟花
  if (detectedPeers.length === 0) {
    stopFireworks();
    return;
  }

  // 检查是否所有检测到的用户都在视频中且都开心
  const allPeersHappy = detectedPeers.length > 0 && 
    detectedPeers.every(peerId => {
      // 检查用户是否在视频中（通过检查 sparkleElements 中是否存在该用户）
      const isVisible = sparkleElements[peerId] !== undefined;
      // 检查用户是否开心
      const isHappy = happinessStates[peerId] > 0.9;
      return isVisible && isHappy;
    });

  if (allPeersHappy) {
    // Start or continue fireworks
    if (!fireworkInterval) {
      startContinuousFireworks();
    }
  } else {
    // Stop fireworks
    stopFireworks();
  }
}

// Start continuous fireworks
function startContinuousFireworks() {
  if (fireworkInterval) return;
  
  // Hide all sparkles
  Object.values(sparkleElements).forEach(sparkle => {
    sparkle.classList.add('hidden');
  });

  // Create fireworks every 500ms
  fireworkInterval = setInterval(() => {
    createFirework();
  }, 500);
}

// Stop fireworks
function stopFireworks() {
  if (fireworkInterval) {
    clearInterval(fireworkInterval);
    fireworkInterval = null;
    
    // Show all sparkles again
    Object.values(sparkleElements).forEach(sparkle => {
      sparkle.classList.remove('hidden');
    });
  }
}

// Create firework effect
function createFirework() {
  const colors = ['#ff0', '#f0f', '#0ff', '#f00', '#0f0'];
  const numParticles = 50;
  
  for (let i = 0; i < numParticles; i++) {
    const particle = document.createElement('div');
    particle.className = 'firework';
    
    particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    
    const startX = Math.random() * window.innerWidth;
    const startY = Math.random() * window.innerHeight;
    particle.style.left = startX + 'px';
    particle.style.top = startY + 'px';
    
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 200 + 100;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance;
    
    particle.style.setProperty('--tx', `${tx}px`);
    particle.style.setProperty('--ty', `${ty}px`);
    
    effectsLayer.appendChild(particle);
    
    setTimeout(() => {
      particle.remove();
    }, 1000);
  }
}

// Create fixed sparkle for a peer
function createFixedSparkle(peerId) {
  // Check if peerId is valid
  if (!peerId) {
    console.warn('Invalid peerId provided to createFixedSparkle');
    return;
  }

  const sparkle = document.createElement('div');
  sparkle.className = 'sparkle';
  
  // Calculate fixed position based on peerId
  const hash = peerId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const x = (hash % 80) + 10; // 10% to 90% of screen width
  const y = ((hash * 7) % 80) + 10; // 10% to 90% of screen height
  
  sparkle.style.left = x + '%';
  sparkle.style.top = y + '%';
  
  effectsLayer.appendChild(sparkle);
  sparkleElements[peerId] = sparkle;
}
