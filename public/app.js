// When the page loads, execute initCapture() to start capturing the video stream
window.addEventListener('load', () => {
  // 初始化诗句元素
  poemElement = document.getElementById('poem');
  if (poemElement) {
    poemElement.innerHTML = "Capturing stray resonance frequencies…";
    poemElement.classList.add('visible');
  }
  
  initCapture();
});

// 当用户关闭页面时，清理资源
window.addEventListener('beforeunload', () => {
  // 停止所有视频流
  if (myLocalMediaStream) {
    myLocalMediaStream.getTracks().forEach(track => track.stop());
  }
  
  // 停止烟花效果
  stopFireworks();
  
  // 清理所有连接
  Object.values(myFriends).forEach(connection => {
    if (connection) {
      connection.destroy();
    }
  });
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
let userColors = {}; // 存储所有用户的颜色映射
let userCoordinates = {}; // 存储所有用户的坐标信息
let faceDisappearTimers = {}; // 存储人脸消失的计时器
let poemElement = null; // 存储诗句元素引用
let isFaceDetected = false; // 跟踪是否有人脸被检测到
let fireworkHasTriggered = false; // 跟踪烟花是否已触发过
let loneSmileTimeout = null; // 存储单人微笑超时计时器

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

  // Set up socket connection first
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
    
    // Start face detection after socket connection is established
    const videoEl = document.getElementById('myVideo');
    if (videoEl && videoEl.readyState >= 2) { // Ensure video is ready
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
    
    // 连接建立后，如果有颜色和坐标信息，发送给对方
    if (userColors[socket.id]) {
      const userData = {
        type: 'user-data',
        socketId: socket.id,
        color: userColors[socket.id],
        coordinates: userCoordinates[socket.id] || generateNewUserCoordinates()
      };
      peerConnection.send(JSON.stringify(userData));
    }
  });

  // 接收对方发送的数据
  peerConnection.on('data', data => {
    try {
      const parsedData = JSON.parse(data);
      // 处理用户数据（同时包含颜色和坐标）
      if (parsedData.type === 'user-data') {
        const { socketId, color, coordinates } = parsedData;
        // 保存颜色信息
        userColors[socketId] = color;
        // 保存坐标信息
        userCoordinates[socketId] = coordinates;
        
        // 如果已经创建了这个用户的粒子，更新其颜色和坐标
        if (sparkleElements[socketId]) {
          const sparkle = sparkleElements[socketId];
          // 更新颜色
          sparkle.style.backgroundColor = color;
          sparkle.dataset.originalColor = color;
          
          // 更新坐标显示
          const coordsElement = sparkle.querySelector('.sparkle-coordinates');
          if (coordsElement) {
            coordsElement.textContent = `(${coordinates.l}°, ${coordinates.b}°)`;
          }
        }
      }
      // 处理旧的颜色消息（向后兼容）
      else if (parsedData.type === 'user-color') {
        // 收到对方的颜色信息
        const { socketId, color } = parsedData;
        userColors[socketId] = color;
        
        // 如果已经创建了这个用户的粒子，更新其颜色
        if (sparkleElements[socketId]) {
          sparkleElements[socketId].style.backgroundColor = color;
          sparkleElements[socketId].dataset.originalColor = color;
        }
      } 
      // 处理颜色请求
      else if (parsedData.type === 'request-color') {
        // 每次收到颜色请求，重新生成颜色和坐标并发送
        generateNewUserColor();
        generateNewUserCoordinates();
        
        // 发送新生成的颜色和坐标
        const userData = {
          type: 'user-data',
          socketId: socket.id,
          color: userColors[socket.id],
          coordinates: userCoordinates[socket.id]
        };
        peerConnection.send(JSON.stringify(userData));
        
        // 更新本地粒子
        if (sparkleElements[socket.id]) {
          const sparkle = sparkleElements[socket.id];
          // 更新颜色
          sparkle.style.backgroundColor = userColors[socket.id];
          sparkle.dataset.originalColor = userColors[socket.id];
          
          // 更新坐标
          const coordsElement = sparkle.querySelector('.sparkle-coordinates');
          if (coordsElement && userCoordinates[socket.id]) {
            coordsElement.textContent = `(${userCoordinates[socket.id].l}°, ${userCoordinates[socket.id].b}°)`;
          }
        }
      }
    } catch (error) {
      console.warn('Failed to parse received data:', error);
    }
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

  // Ensure socket is initialized and connected
  if (!socket || !socket.id) {
    console.warn('Socket not initialized or not connected');
    return;
  }

  // Get peerId
  const peerId = canvasId === 'myCanvas' ? socket.id : canvasId.replace('canvas_', '');
  if (!peerId) {
    console.warn('Invalid peerId generated in startFaceDetection:', { canvasId, socketId: socket.id });
    return;
  }

  // Create context with willReadFrequently property
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // 确保获取诗句元素引用
  if (!poemElement) {
    poemElement = document.getElementById('poem');
  }

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
      // 清除人脸消失计时器（如果存在）
      if (faceDisappearTimers[peerId]) {
        clearTimeout(faceDisappearTimers[peerId]);
        delete faceDisappearTimers[peerId];
      }
      
      // 标记有人脸被检测到
      isFaceDetected = true;
      
      // 显示诗句，如果所有人脸都消失过，则重置诗句内容为初始状态
      if (poemElement) {
        // 确保当人脸出现时，诗句内容切换到初始诗句
        // 但如果当前是单人微笑的诗句，则保持不变
        if (poemElement.innerHTML === "Capturing stray resonance frequencies…" ||
            !poemElement.classList.contains('visible')) {
          // 重置为初始诗句内容
          poemElement.innerHTML = "Every smile is a unique frequency<br>When two waves resonate<br>A new cosmos is born.";
          
          // 确保诗句可见
          if (!poemElement.classList.contains('visible')) {
            poemElement.classList.add('visible');
          }
        }
      }
      
      const happiness = resizedDetections[0].expressions.happy;
      happinessStates[peerId] = happiness;
      
      // 如果用户出现但没有光点，或者光点处于隐藏状态，需要重新创建/显示光点
      if (!sparkleElements[peerId] || sparkleElements[peerId].classList.contains('hidden')) {
        // 如果是本地用户，生成新颜色并通知所有远程用户
        if (peerId === socket.id) {
          // 生成新的随机颜色
          generateNewUserColor();
          
          // 通知所有连接的对等端
          Object.values(myFriends).forEach(peerConnection => {
            if (peerConnection.connected) {
              const userData = {
                type: 'user-data',
                socketId: socket.id,
                color: userColors[socket.id],
                coordinates: userCoordinates[socket.id]
              };
              peerConnection.send(JSON.stringify(userData));
            }
          });
        } 
        // 如果是远程用户，始终请求其颜色信息
        else {
          // 找到对应的连接
          const peerConnection = myFriends[peerId];
          if (peerConnection && peerConnection.connected) {
            // 发送颜色请求
            const requestData = {
              type: 'request-color',
              socketId: socket.id
            };
            peerConnection.send(JSON.stringify(requestData));
          }
        }
        
        // 创建或显示光点
        if (!sparkleElements[peerId]) {
          createFixedSparkle(peerId);
        } else {
          sparkleElements[peerId].classList.remove('hidden');
        }
      }
      
      if (sparkleElements[peerId]) {
        const sparkle = sparkleElements[peerId];
        
        // Handle happiness state change
        if (happiness > 0.8) {
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
          // 当用户不再微笑时，清除单人微笑计时器
          clearLoneSmileTimeout();
        }
      }

      // Check firework state
      checkFireworkState();
    } else {
      // 没有检测到人脸，设置一个延迟，在一定时间后认为人脸真的消失了
      if (!faceDisappearTimers[peerId]) {
        faceDisappearTimers[peerId] = setTimeout(() => {
          // 人脸确认消失，进行清理
          happinessStates[peerId] = 0;
          
          if (sparkleElements[peerId]) {
            const sparkle = sparkleElements[peerId];
            // 移除happy状态
            sparkle.classList.remove('happy');
            
            // 清除计时器
            if (sparkleTimers[peerId]) {
              clearTimeout(sparkleTimers[peerId]);
              delete sparkleTimers[peerId];
            }
            
            // 隐藏光点（坐标会随父元素一起隐藏）
            sparkle.classList.add('hidden');
            
            // 删除颜色和坐标信息
            delete userColors[peerId];
            delete userCoordinates[peerId];
          }
          
          // 检查是否还有其他用户的人脸
          const anyFaceDetected = Object.keys(happinessStates).some(id => {
            return happinessStates[id] > 0;
          });
          
          // 如果没有任何人脸，隐藏诗句并重置fireworkHasTriggered状态
          if (!anyFaceDetected) {
            isFaceDetected = false;
            if (poemElement) {
              // 显示"Capturing stray resonance frequencies…"
              poemElement.innerHTML = "Capturing stray resonance frequencies…";
              // 保持诗句可见
              if (!poemElement.classList.contains('visible')) {
                poemElement.classList.add('visible');
              }
            }
            // 重置烟花触发状态，以便下次人脸重新出现时诗句为初始状态
            fireworkHasTriggered = false;
            // 清除单人微笑计时器
            clearLoneSmileTimeout();
          }
          
          checkFireworkState();
          delete faceDisappearTimers[peerId];
        }, 1000); // 1秒后确认人脸消失
      }
    }
  }, 100);
}

// 为用户生成一个新的随机颜色
function generateNewUserColor() {
  const colors = ['#ff0', '#f0f', '#0ff', '#f00', '#0f0'];
  // 完全随机选择一个颜色
  const randomColor = colors[Math.floor(Math.random() * colors.length)];
  userColors[socket.id] = randomColor;
  return randomColor;
}

// 为用户生成一个新的随机坐标
function generateNewUserCoordinates() {
  // l的范围是0°到360°
  const l = Math.floor(Math.random() * 361);
  // b的范围是-90°到+90°
  const b = Math.floor(Math.random() * 181) - 90;
  // 格式化坐标并存储
  const coordinates = { l, b };
  userCoordinates[socket.id] = coordinates;
  return coordinates;
}

// Check if fireworks should be shown or stopped
function checkFireworkState() {
  // Get all detected users
  const detectedPeers = Object.keys(happinessStates);
  
  // If no users are detected, stop fireworks
  if (detectedPeers.length === 0) {
    stopFireworks();
    clearLoneSmileTimeout(); // 清除单人微笑计时器
    return;
  }

  // Get users who are visible and happy
  const happyPeers = detectedPeers.filter(peerId => {
    // 检查用户是否在视频中（通过检查sparkleElements是否存在且不隐藏）
    const isVisible = sparkleElements[peerId] !== undefined && 
                     !sparkleElements[peerId].classList.contains('hidden');
    // 检查用户是否开心
    const isHappy = happinessStates[peerId] > 0.8;
    return isVisible && isHappy;
  });

  // Only start fireworks if there are at least 2 happy peers
  if (happyPeers.length >= 2) {
    // Start or continue fireworks
    if (!fireworkInterval) {
      // 获取开心用户的颜色，传递给startContinuousFireworks函数
      const happyColors = happyPeers
        .map(peerId => sparkleElements[peerId]?.dataset.originalColor)
        .filter(color => color);
      startContinuousFireworks(happyColors);
    }
    // 清除单人微笑计时器，因为现在有多人开心
    clearLoneSmileTimeout();
  } else if (happyPeers.length === 1) {
    // 只有一个人开心
    // 停止烟花效果
    stopFireworks();
    
    // 如果还没有设置单人微笑计时器，则设置一个
    if (!loneSmileTimeout) {
      loneSmileTimeout = setTimeout(() => {
        // 如果10秒后仍然只有一个人开心，且没有触发烟花效果
        if (!fireworkInterval && poemElement) {
          // 获取开心的用户
          const happyPeer = happyPeers[0];
          // 检查这个用户是否仍然开心
          if (sparkleElements[happyPeer] && 
              !sparkleElements[happyPeer].classList.contains('hidden') &&
              happinessStates[happyPeer] > 0.8) {
            // 显示单人微笑的诗句
            poemElement.innerHTML = "Lone resonator, your frequency will find its echo someday.";
          }
        }
        // 清除计时器，以便下次可以再次触发
        loneSmileTimeout = null;
      }, 10000); // 10秒后显示
    }
  } else {
    // 没有人开心
    stopFireworks();
    clearLoneSmileTimeout(); // 清除单人微笑计时器
  }
}

// 清除单人微笑计时器的辅助函数
function clearLoneSmileTimeout() {
  if (loneSmileTimeout) {
    clearTimeout(loneSmileTimeout);
    loneSmileTimeout = null;
  }
}

// Start continuous fireworks
function startContinuousFireworks(happyColors = []) {
  if (fireworkInterval) return;
  
  // 将所有粒子颜色改为黑色
  Object.values(sparkleElements).forEach(sparkle => {
    if (!sparkle.classList.contains('hidden')) {
      sparkle.style.backgroundColor = '#000000'; // 黑色
      
      // 隐藏坐标显示
      const coordsElement = sparkle.querySelector('.sparkle-coordinates');
      if (coordsElement) {
        coordsElement.style.opacity = '0';
      }
    }
  });
  
  // 将诗句变为黑色（完全不可见）
  if (poemElement) {
    poemElement.classList.add('dark');
  }
  
  // 标记烟花已经触发过
  fireworkHasTriggered = true;

  // Play firework sound
  const fireworkSound = document.getElementById('fireworkSound');
  if (fireworkSound) {
    fireworkSound.currentTime = 0; // Reset sound to start
    fireworkSound.play().catch(error => {
      console.warn('Could not play firework sound:', error);
    });
  }

  // Create fireworks every 500ms
  fireworkInterval = setInterval(() => {
    createFirework(happyColors);
  }, 500);
}

// Stop fireworks
function stopFireworks() {
  if (fireworkInterval) {
    clearInterval(fireworkInterval);
    fireworkInterval = null;
    
    // Stop firework sound
    const fireworkSound = document.getElementById('fireworkSound');
    if (fireworkSound) {
      fireworkSound.pause();
      fireworkSound.currentTime = 0;
    }
    
    // 恢复所有粒子的原始颜色
    Object.values(sparkleElements).forEach(sparkle => {
      if (!sparkle.classList.contains('hidden') && sparkle.dataset.originalColor) {
        sparkle.style.backgroundColor = sparkle.dataset.originalColor;
        
        // 恢复坐标显示
        const coordsElement = sparkle.querySelector('.sparkle-coordinates');
        if (coordsElement) {
          coordsElement.style.opacity = '0.8';
        }
      }
    });
    
    // 如果烟花曾经触发过，更改诗句内容
    if (fireworkHasTriggered && poemElement) {
      poemElement.innerHTML = "What matters is: your frequency once rippled through the cosmos.";
    }
    
    // 恢复诗句为金色（可见）
    if (poemElement) {
      poemElement.classList.remove('dark');
    }
  }
}

// Create firework effect
function createFirework(userColors = []) {
  // 使用用户的颜色，如果没有提供，则使用默认颜色
  const colors = userColors.length > 0 ? userColors : ['#ff0', '#f0f', '#0ff', '#f00', '#0f0'];
  const numParticles = 100;
  
  for (let j=0; j<10; j++){
    const startX = Math.random() * window.innerWidth;
    const startY = Math.random() * window.innerHeight;
    
    for (let i = 0; i < numParticles; i++) {
      const particle = document.createElement('div');
      particle.className = 'firework';

      // 从用户颜色中随机选择一个
      particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];

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
      }, 10000);
    }
  }
}

// Create fixed sparkle for a peer
function createFixedSparkle(peerId) {
  // Check if peerId is valid
  if (!peerId) {
    console.warn('Invalid peerId provided to createFixedSparkle');
    return;
  }

  let userColor;
  let coordinates;
  
  // 如果是本地用户
  if (peerId === socket.id) {
    // 检查是否已经有颜色，如果没有则生成
    userColor = userColors[peerId] || generateNewUserColor();
    // 检查是否已经有坐标，如果没有则生成
    coordinates = userCoordinates[peerId] || generateNewUserCoordinates();
  } else {
    // 如果是远程用户，使用从对方接收到的颜色和坐标
    userColor = userColors[peerId];
    coordinates = userCoordinates[peerId];
    
    // 如果还没有收到远程用户的颜色，使用默认颜色
    if (!userColor) {
      const colors = ['#ff0', '#f0f', '#0ff', '#f00', '#0f0'];
      userColor = colors[0]; // 默认使用第一个颜色，后续会更新
    }
    
    // 如果还没有收到远程用户的坐标，使用临时坐标
    if (!coordinates) {
      coordinates = { l: 0, b: 0 }; // 使用默认坐标，后续会更新
    }
  }

  // 格式化坐标显示
  const coordsText = `(${coordinates.l}°, ${coordinates.b}°)`;

  // 如果已经存在这个用户的粒子，只需更新颜色和坐标
  if (sparkleElements[peerId]) {
    const sparkle = sparkleElements[peerId];
    sparkle.style.backgroundColor = userColor;
    sparkle.dataset.originalColor = userColor;
    
    // 更新坐标显示
    let coordsElement = sparkle.querySelector('.sparkle-coordinates');
    if (!coordsElement) {
      coordsElement = document.createElement('div');
      coordsElement.className = 'sparkle-coordinates';
      sparkle.appendChild(coordsElement);
    }
    coordsElement.textContent = coordsText;
    
    sparkle.classList.remove('hidden');
    return;
  }

  const sparkle = document.createElement('div');
  sparkle.className = 'sparkle';
  
  // 设置与烟花粒子相同的样式
  sparkle.style.backgroundColor = userColor;
  // 存储原始颜色，以便在烟花结束后恢复
  sparkle.dataset.originalColor = userColor;
  sparkle.style.width = '20px';
  sparkle.style.height = '20px';
  sparkle.style.borderRadius = '50%';
  sparkle.style.boxShadow = 'none';
  
  // Calculate fixed position based on peerId
  const hash = peerId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const x = (hash % 80) + 10; // 10% to 90% of screen width
  const y = ((hash * 7) % 80) + 10; // 10% to 90% of screen height
  
  sparkle.style.left = x + '%';
  sparkle.style.top = y + '%';
  
  // 添加坐标显示
  const coordsElement = document.createElement('div');
  coordsElement.className = 'sparkle-coordinates';
  coordsElement.textContent = coordsText;
  sparkle.appendChild(coordsElement);
  
  effectsLayer.appendChild(sparkle);
  sparkleElements[peerId] = sparkle;
}
