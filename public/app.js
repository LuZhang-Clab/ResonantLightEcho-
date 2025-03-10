// When the page loads, execute initCapture() to start capturing the video stream
window.addEventListener('load', () => {
  initCapture();
});

// Global variables
let myLocalMediaStream; // Stores the local video stream
let socket; // WebSocket connection object
let myFriends = {}; // Stores all connected peers
let faceCanvas = {}; // Stores the face detection canvas for each peer

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
  const canvas = document.getElementById(canvasId); // Get the canvas element by id
  console.log(canvasId);

  const displaySize = { width: videoEl.width, height: videoEl.height };
  faceapi.matchDimensions(canvas, displaySize); // Match the canvas size to the video

  // Set an interval to perform face detection every 100ms
  setInterval(async () => {
    if (videoEl.width === 0 || videoEl.height === 0) {
      console.warn("Skipping face detection: Video not ready.");
      return;
    }

    // Detect faces, landmarks, and expressions
    const detections = await faceapi
      .detectAllFaces(videoEl, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceExpressions();

    const resizedDetections = faceapi.resizeResults(detections, displaySize); // Resize the results to match the video

    // Draw the detection results on the canvas
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear the canvas before drawing new results
    faceapi.draw.drawDetections(canvas, resizedDetections);
    faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);
    faceapi.draw.drawFaceExpressions(canvas, resizedDetections);
  }, 100);
}
