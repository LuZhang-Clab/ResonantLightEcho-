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
      startFaceDetection(videoEl, 'myCanvas'); // Start face detection once the video is ready
    };
  } catch (err) {
    console.error("Error accessing webcam: ", err);
  }

  setupSocket(); // Connect to WebSocket and establish P2P connections
}

// Adjust canvas size to match video dimensions
function adjustCanvasSize(videoEl, canvasId) {
  let canvas = document.getElementById(canvasId);
  if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
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
    document.body.appendChild(theirCanvas);

    faceCanvas[theirSocketId] = theirCanvas;

    //adjustCanvasSize(theirVideoEl, theirCanvas.id); // Adjust Canvas to match Video

    startFaceDetection(theirVideoEl, theirCanvas.id); // Start facial expression detection for the remote user
  });

  return peerConnection; // Return the peer connection object
}

// Face Detection Function for both local and remote videos
function startFaceDetection(videoEl, canvasId) {
  const canvas = document.getElementById(canvasId);
  console.log(canvasId);

  const displaySize = { width: videoEl.width, height: videoEl.height };
  faceapi.matchDimensions(canvas, displaySize);

  // Initialize effects layer if not already done
  if (!effectsLayer) {
    effectsLayer = document.getElementById('effects-layer');
  }

  // Create fixed sparkle for this peer
  const peerId = canvasId === 'myCanvas' ? socket.id : canvasId.replace('canvas_', '');
  createFixedSparkle(peerId);

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

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    faceapi.draw.drawDetections(canvas, resizedDetections);
    faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);
    faceapi.draw.drawFaceExpressions(canvas, resizedDetections);

    // Check happiness level and update sparkle visibility
    if (resizedDetections.length > 0) {
      const happiness = resizedDetections[0].expressions.happy;
      happinessStates[peerId] = happiness;
      
      // Update sparkle animation based on happiness
      if (sparkleElements[peerId]) {
        const sparkle = sparkleElements[peerId];
        if (happiness > 0.9) {
          sparkle.classList.add('happy');
        } else {
          sparkle.classList.remove('happy');
        }
      }

      // Check if all peers are happy
      const allPeersHappy = Object.values(happinessStates).every(h => h > 0.9);
      if (allPeersHappy) {
        createFirework();
      }
    }
  }, 100);
}

// Create fixed sparkle for a peer
function createFixedSparkle(peerId) {
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

// Create firework effect
function createFirework() {
  // Hide all sparkles
  Object.values(sparkleElements).forEach(sparkle => {
    sparkle.classList.add('hidden');
  });

  const colors = ['#ff0', '#f0f', '#0ff', '#f00', '#0f0'];
  const numParticles = 50;
  
  for (let i = 0; i < numParticles; i++) {
    const particle = document.createElement('div');
    particle.className = 'firework';
    
    // Random color
    particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    
    // Random starting position
    const startX = Math.random() * window.innerWidth;
    const startY = Math.random() * window.innerHeight;
    particle.style.left = startX + 'px';
    particle.style.top = startY + 'px';
    
    // Random direction and distance
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 200 + 100;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance;
    
    particle.style.setProperty('--tx', `${tx}px`);
    particle.style.setProperty('--ty', `${ty}px`);
    
    effectsLayer.appendChild(particle);
    
    // Remove particle after animation and show sparkles again
    setTimeout(() => {
      particle.remove();
      if (i === numParticles - 1) { // Only on the last particle
        // Show all sparkles again
        Object.values(sparkleElements).forEach(sparkle => {
          sparkle.classList.remove('hidden');
        });
      }
    }, 1000);
  }
}
