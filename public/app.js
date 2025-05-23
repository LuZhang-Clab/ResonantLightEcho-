// When the page loads, execute initCapture() to start capturing the video stream
window.addEventListener('load', () => {
  // 初始化诗句元素
  poemElement = document.getElementById('poem');
  if (poemElement) {
    poemElement.innerHTML = "In the depths of the cosmos lies the Starfield of Resonance, a hidden energy field that resonates with smiles. <br>When two sincere stars meet here, they ignite splendid nebular fireworks.<br> Explore it, shall we?";
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
});

// Global variables
let myLocalMediaStream; // Stores the local video stream
let faceCanvas = {}; // Stores the face detection canvas for each peer
let happinessStates = {}; // Stores happiness states for each peer
let effectsLayer; // Reference to the effects layer
let sparkleElements = {}; // Stores sparkle elements for each peer
let sparkleTimers = {}; // Store timers for each sparkle
let fireworkInterval = null; // Store the firework interval
let userColors = {}; // 存储所有用户的颜色映射
let userCoordinates = {}; // 存储所有用户的坐标信息
let faceAppearTimers = {}; // 存储人脸出现的计时器
let faceDisappearTimers = {}; // 存储人脸消失的计时器
let poemElement = null; // 存储诗句元素引用
let isFaceDetected = false; // 跟踪是否有人脸被检测到
let fireworkHasTriggered = false; // 跟踪烟花是否已触发过
let loneSmileTimeout = null; // 存储单人微笑超时计时器
let heartBeatAudio = null; // 全局心跳音效audio
let isOrbiting = false;
let orbitAnimationId = null;
let violinCelloAudio = null;
let orbitSparkleIds = [];
let orbitBasePositions = [];
const ORBIT_NEAR_PERCENT = 0.12; // 12%屏幕宽度为靠近
const ORBIT_FAR_PERCENT = 0.8;  // 80%屏幕宽度为远离
let poemTimeout = null;

// 替换为新的光球颜色系列
const SPARKLE_COLORS = [
  '#00FFFF', // 青色
  '#E1C16E', // 金色
  '#AFE1AF', // 淡绿色
  '#FF7518', // 橙色
  '#DE3163', // 深粉红
  '#FF10F0', // 亮粉红
  '#FFC0CB', // 粉红
  '#CF9FFF', // 淡紫色
  '#7F00FF', // 紫色
  '#D70040', // 深红
  '#FAFA33', // 黄色
  '#FAFA33'  // 黄色
];

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
  let constraints = { 
    audio: true, 
    video: { 
      width: { ideal: 640 },
      height: { ideal: 480 },
      facingMode: "user"
    } 
  }; // Set audio and video constraints

  // Request user permission to access the camera and microphone
  try {
    let stream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('Got local stream', stream); // Ensure the stream is successfully captured
    myLocalMediaStream = stream; // Store the local video stream
    videoEl.srcObject = stream; // Bind the video stream to the video element

    // Ensure video is loaded and play, then adjust canvas size and start face detection
    videoEl.onloadedmetadata = () => {
      console.log('Video metadata loaded, starting playback...');
      videoEl.play().catch(err => {
        console.error('Error playing video:', err);
        // 如果自动播放失败，添加点击事件监听器
        document.addEventListener('click', () => {
          videoEl.play().catch(e => console.error('Error playing video after click:', e));
        }, { once: true });
      });
      adjustCanvasSize(videoEl, 'myCanvas'); // Adjust Canvas to match Video
      startFaceDetection(videoEl, 'myCanvas');
    };
  } catch (err) {
    console.error("Error accessing webcam: ", err);
    // 如果获取视频流失败，尝试使用备用约束
    try {
      constraints = { audio: true, video: true };
      let stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Got local stream with fallback constraints', stream);
      myLocalMediaStream = stream;
      videoEl.srcObject = stream;
      
      videoEl.onloadedmetadata = () => {
        console.log('Video metadata loaded with fallback, starting playback...');
        videoEl.play().catch(err => {
          console.error('Error playing video with fallback:', err);
          document.addEventListener('click', () => {
            videoEl.play().catch(e => console.error('Error playing video after click:', e));
          }, { once: true });
        });
        adjustCanvasSize(videoEl, 'myCanvas');
        startFaceDetection(videoEl, 'myCanvas');
      };
    } catch (fallbackErr) {
      console.error("Error accessing webcam with fallback constraints: ", fallbackErr);
    }
  }
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

  // 获取canvas的上下文
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    console.warn('Failed to get canvas context');
    return;
  }

  if (!effectsLayer) {
    effectsLayer = document.getElementById('effects-layer');
    if (!effectsLayer) {
      console.warn('Effects layer not found');
      return;
    }
  }

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

    // 处理检测到的所有人脸
    if (resizedDetections.length > 0) {
      // 标记有人脸被检测到
      isFaceDetected = true;
      
      // 显示诗句，如果所有人脸都消失过，则重置诗句内容为初始状态
      if (poemElement) {
        if (poemElement.innerHTML === "In the depths of the cosmos lies the Starfield of Resonance, a hidden energy field that resonates with smiles. <br>When two sincere stars meet here, they ignite splendid nebular fireworks.<br> Explore it, shall we? " ||
            !poemElement.classList.contains('visible')) {
          poemElement.innerHTML = "Every smile of joy pulses in its own wavelength. <br> When paried flows converge, brilliant flares bloom.<br>";
          if (!poemElement.classList.contains('visible')) {
            poemElement.classList.add('visible');
          }
        }
      }

      // 为每个检测到的人脸创建或更新sparkle
      resizedDetections.forEach((detection, index) => {
        const faceId = `face_${index}`;
        const happiness = detection.expressions.happy;
        happinessStates[faceId] = happiness;

        // 获取人脸在视频中的位置
        const faceBox = detection.detection.box;
        
        // 计算人脸在视频中的相对位置（0-1之间）
        const relativeX = (faceBox.x + (faceBox.width / 2)) / canvas.width;
        const relativeY = (faceBox.y + (faceBox.height / 2)) / canvas.height;
        
        // 将相对位置映射到窗口大小
        const windowX = window.innerWidth * (1 - relativeX); // 考虑镜像效果
        const windowY = window.innerHeight * relativeY;

        // 清除这个face的消失计时器（如果存在）
        if (faceDisappearTimers[faceId]) {
          clearTimeout(faceDisappearTimers[faceId]);
          delete faceDisappearTimers[faceId];
        }

        // 如果这个人脸还没有对应的sparkle，创建一个新的
        if (!sparkleElements[faceId]) {
          createFixedSparkle(faceId);
        }

        // 如果这个人脸还没有开始计时，开始计时
        if (!faceAppearTimers[faceId]) {
          faceAppearTimers[faceId] = setTimeout(() => {
            // 3秒后，如果sparkle还存在，将其变为实心并分配颜色
            if (sparkleElements[faceId]) {
              const sparkle = sparkleElements[faceId];
              sparkle.classList.add('filled');
              
              // 生成并设置颜色
              const color = generateNewUserColor();
              sparkle.style.setProperty('--sparkle-main', color);
              sparkle.dataset.originalColor = color;
            }
          }, 3000);
        }

        // 更新sparkle的状态和位置
        if (sparkleElements[faceId]) {
          const sparkle = sparkleElements[faceId];
          
          // 更新sparkle位置
          sparkle.style.left = `${windowX}px`;
          sparkle.style.top = `${windowY}px`;
          
          // 处理微笑状态
          if (happiness > 0.8) {
            if (!sparkle.classList.contains('happy')) {
              sparkle.classList.add('happy');
              sparkle.classList.remove('expired');
              
              if (sparkleTimers[faceId]) {
                clearTimeout(sparkleTimers[faceId]);
              }
              
              sparkleTimers[faceId] = setTimeout(() => {
                sparkle.classList.add('expired');
                checkFireworkState();
              }, 10000);
              // happy状态变化后检查心跳音效
              checkHeartBeatSound();
            }
          } else {
            if (sparkle.classList.contains('happy')) {
              sparkle.classList.remove('happy');
              // happy状态变化后检查心跳音效
              checkHeartBeatSound();
            }
            if (sparkleTimers[faceId]) {
              clearTimeout(sparkleTimers[faceId]);
              delete sparkleTimers[faceId];
            }
            clearLoneSmileTimeout();
          }
        }
      });

      // 检查烟花状态
      checkFireworkState();
      // 检查ViolinCello音效播放
      checkViolinCelloSound();
    } else {
      // 没有检测到人脸
      isFaceDetected = false;
      
      // 为所有现有的sparkle设置消失计时器
      Object.keys(sparkleElements).forEach(faceId => {
        if (!faceDisappearTimers[faceId]) {
          faceDisappearTimers[faceId] = setTimeout(() => {
            // 3秒后，如果sparkle还存在，将其移除
            if (sparkleElements[faceId]) {
              const sparkle = sparkleElements[faceId];
              // 先添加淡出动画
              sparkle.style.transition = 'opacity 0.5s ease-out';
              sparkle.style.opacity = '0';
              
              // 同时淡出坐标显示
              const coordsElement = sparkle.querySelector('.sparkle-coordinates');
              if (coordsElement) {
                coordsElement.style.transition = 'opacity 0.5s ease-out';
                coordsElement.style.opacity = '0';
              }
              
              // 等待淡出动画完成后移除元素
              setTimeout(() => {
                sparkle.remove();
                delete sparkleElements[faceId];
                delete happinessStates[faceId];
                delete userColors[faceId];
                delete userCoordinates[faceId];
                delete faceAppearTimers[faceId];
              }, 500);
            }
          }, 3000);
        }
      });

      // 更新诗句
      if (poemElement) {
        poemElement.innerHTML = "In the depths of the cosmos lies the Starfield of Resonance, a hidden energy field that resonates with smiles. <br>When two sincere stars meet here, they ignite splendid nebular fireworks.<br> Explore it, shall we?";
        if (!poemElement.classList.contains('visible')) {
          poemElement.classList.add('visible');
        }
      }

      // 重置烟花状态
      fireworkHasTriggered = false;
      clearLoneSmileTimeout();
      stopFireworks();
    }
  }, 100);
}

// 修改为单人模式的颜色生成
function generateNewUserColor() {
  const color = SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)];
  userColors['local'] = color;
  return color;
}

// 修改为单人模式的坐标生成
function generateNewUserCoordinates() {
  const coordinates = {
    l: Math.floor(Math.random() * 360),
    b: Math.floor(Math.random() * 180) - 90
  };
  userCoordinates['local'] = coordinates;
  return coordinates;
}

// Check if fireworks should be shown or stopped
function checkFireworkState() {
  // 获取所有检测到的人脸
  const detectedFaces = Object.keys(happinessStates);
  
  // 如果没有检测到人脸，停止烟花
  if (detectedFaces.length === 0) {
    stopFireworks();
    clearLoneSmileTimeout();
    return;
  }

  // 获取所有开心的人脸
  const happyFaces = detectedFaces.filter(faceId => {
    const isHappy = happinessStates[faceId] > 0.8;
    return isHappy;
  });

  // 如果有至少2个人脸开心，触发烟花
  if (happyFaces.length >= 2) {
    if (!fireworkInterval) {
      // 获取开心人脸的颜色
      const happyColors = happyFaces
        .map(faceId => sparkleElements[faceId]?.dataset.originalColor)
        .filter(color => color);
      startContinuousFireworks(happyColors);
    }
    clearLoneSmileTimeout();
  } else if (happyFaces.length === 1) {
    // 只有一个人脸开心
    stopFireworks();
    
    // 如果还没有设置单人微笑计时器，则设置一个
    if (!loneSmileTimeout) {
      loneSmileTimeout = setTimeout(() => {
        // 如果10秒后仍然只有一个人脸开心，且没有触发烟花效果
        if (!fireworkInterval && poemElement) {
          // 获取开心的人脸
          const happyFace = happyFaces[0];
          // 检查这个脸是否仍然开心
          if (sparkleElements[happyFace] && 
              !sparkleElements[happyFace].classList.contains('hidden') &&
              happinessStates[happyFace] > 0.8) {
            // 显示单人微笑的诗句
            showPoemForDuration("Drifting star, your frequency will one day meet its harmonic twin.");
          }
        }
        // 清除计时器，以便下次可以再次触发
        loneSmileTimeout = null;
      }, 10000); // 10秒后显示
    }
  } else {
    // 没有人脸开心
    stopFireworks();
    clearLoneSmileTimeout();
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
function startContinuousFireworks(colors) {
  if (fireworkInterval) return;
  stopViolinCello(); // 触发烟花时立刻停止ViolinCello
  // 让所有已分配颜色的sparkle（.filled）变为透明
  Object.values(sparkleElements).forEach(sparkle => {
    if (sparkle && sparkle.classList.contains('filled')) {
      sparkle.style.setProperty('--sparkle-main', 'rgba(0,0,0,0)');
      sparkle.style.opacity = '0';
      // 隐藏坐标
      const coords = sparkle.querySelector('.sparkle-coordinates');
      if (coords) coords.style.opacity = 0;
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
    createFirework(colors);
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
    
    // 恢复所有粒子的原始颜色和不透明度
    Object.values(sparkleElements).forEach(sparkle => {
      if (!sparkle.classList.contains('hidden') && sparkle.dataset.originalColor) {
        sparkle.style.setProperty('--sparkle-main', sparkle.dataset.originalColor);
        sparkle.style.opacity = '0.97';
        // 恢复坐标显示
        const coordsElement = sparkle.querySelector('.sparkle-coordinates');
        if (coordsElement) {
          coordsElement.style.opacity = '0.8';
        }
      }
    });
    
    // 如果烟花曾经触发过，更改诗句内容
    const happyFaces = Object.keys(happinessStates).filter(faceId => happinessStates[faceId] > 0.8);
    if (fireworkHasTriggered && poemElement && happyFaces.length < 2) {
      showPoemForDuration("What matters is: your resonance once rippled in the depths of another soul's cosmos.");
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
function createFixedSparkle(faceId) {
  // Check if faceId is valid
  if (!faceId) {
    console.warn('Invalid faceId provided to createFixedSparkle');
    return;
  }

  // 生成坐标
  const coordinates = generateNewUserCoordinates();
  userCoordinates[faceId] = coordinates;
  
  // 格式化坐标显示
  const coordsText = `(${coordinates.l}°, ${coordinates.b}°)`;

  // 如果已经存在这个face的粒子，只需更新坐标
  if (sparkleElements[faceId]) {
    const sparkle = sparkleElements[faceId];
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
  sparkle.style.width = '40px';
  sparkle.style.height = '40px';
  sparkle.style.borderRadius = '50%';
  sparkle.style.boxShadow = 'none';
  // 设置主色为CSS变量（初始为银色）
  sparkle.style.setProperty('--sparkle-main', '#e0eaff');

  // 添加透明发光的外环
  const ring = document.createElement('div');
  ring.className = 'sparkle-ring';
  sparkle.appendChild(ring);

  // 添加坐标显示
  const coordsElement = document.createElement('div');
  coordsElement.className = 'sparkle-coordinates';
  coordsElement.textContent = coordsText;
  sparkle.appendChild(coordsElement);
  
  effectsLayer.appendChild(sparkle);
  sparkleElements[faceId] = sparkle;
}

// 星空生成函数
function createStarfield(numStars = 75) {
  let starfield = document.getElementById('starfield');
  if (!starfield) {
    starfield = document.createElement('div');
    starfield.id = 'starfield';
    document.body.appendChild(starfield);
  }
  const stars = [];
  // 45颗银色星星
  for (let i = 0; i < 45; i++) {
    const star = document.createElement('div');
    const size = Math.random() * 2 + 1; // 1~3px
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const opacity = Math.random() * 0.7 + 0.3;
    const duration = Math.random() * 2 + 1; // 1~3s
    const delay = Math.random() * 3;
    // 漂浮速度（缓慢）
    const vx = (Math.random() - 0.5) * 0.02; // -0.01 ~ 0.01
    const vy = (Math.random() - 0.5) * 0.02;
    star.style.position = 'absolute';
    star.style.left = `${x}vw`;
    star.style.top = `${y}vh`;
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.borderRadius = '50%';
    star.style.background = '#e0eaff';
    star.style.opacity = opacity;
    star.style.boxShadow = `0 0 8px 2px #e0eaff, 0 0 24px 4px #b0c4ff`;
    star.style.animation = `star-twinkle ${duration}s infinite alternate`;
    star.style.animationDelay = `${delay}s`;
    // 自定义属性用于动画
    star.dataset.x = x;
    star.dataset.y = y;
    star.dataset.vx = vx;
    star.dataset.vy = vy;
    starfield.appendChild(star);
    stars.push(star);
  }
  // 30颗彩色星星
  for (let i = 0; i < 30; i++) {
    const star = document.createElement('div');
    const size = Math.random() * 2 + 1; // 1~3px
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const opacity = Math.random() * 0.7 + 0.3;
    const duration = Math.random() * 2 + 1; // 1~3s
    const delay = Math.random() * 3;
    const vx = (Math.random() - 0.5) * 0.02;
    const vy = (Math.random() - 0.5) * 0.02;
    // 随机选取光球颜色
    const color = SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)];
    star.style.position = 'absolute';
    star.style.left = `${x}vw`;
    star.style.top = `${y}vh`;
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.borderRadius = '50%';
    star.style.background = color;
    star.style.opacity = opacity;
    star.style.boxShadow = `0 0 8px 2px ${color}, 0 0 24px 4px ${color}`;
    star.style.animation = `star-twinkle ${duration}s infinite alternate`;
    star.style.animationDelay = `${delay}s`;
    star.dataset.x = x;
    star.dataset.y = y;
    star.dataset.vx = vx;
    star.dataset.vy = vy;
    starfield.appendChild(star);
    stars.push(star);
  }

  // 动画：让星星缓慢漂浮
  function animateStars() {
    for (const star of stars) {
      let x = parseFloat(star.dataset.x);
      let y = parseFloat(star.dataset.y);
      const vx = parseFloat(star.dataset.vx);
      const vy = parseFloat(star.dataset.vy);
      x += vx;
      y += vy;
      // 循环漂浮，超出边界回到另一侧
      if (x < 0) x += 100;
      if (x > 100) x -= 100;
      if (y < 0) y += 100;
      if (y > 100) y -= 100;
      star.dataset.x = x;
      star.dataset.y = y;
      star.style.left = `${x}vw`;
      star.style.top = `${y}vh`;
    }
    requestAnimationFrame(animateStars);
  }
  animateStars();
}

window.addEventListener('DOMContentLoaded', () => {
  createStarfield(75);
  // 不显示任何提示，用户首次点击页面任意处时播放音效
  document.body.addEventListener('click', playSpaceAmbient, { once: true });
});

// 播放宇宙白噪音音效
function playSpaceAmbient() {
  let audio = document.getElementById('space-audio');
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = 'space-audio';
    audio.src = 'AmbientSpaceNoise.mp3';
    audio.loop = true;
    audio.preload = 'auto';
    document.body.appendChild(audio);
  }
  audio.volume = 0.5;
  audio.play();
}

// 在显示初始介绍语时调用播放
function showIntroText() {
  const poemElement = document.getElementById('poem');
  poemElement.innerHTML = `In the depths of the cosmos lies the Starfield of Resonance, a hidden energy field that resonates with smiles. <br>When two sincere stars meet here, they ignite splendid nebular fireworks.<br> Explore it, shall we?`;
  poemElement.classList.add('visible');
  playSpaceAmbient();
}

function playHeartBeat() {
  if (!heartBeatAudio) {
    heartBeatAudio = document.createElement('audio');
    heartBeatAudio.src = 'HeartBeat.mp3';
    heartBeatAudio.loop = true;
    heartBeatAudio.preload = 'auto';
    document.body.appendChild(heartBeatAudio);
  }
  heartBeatAudio.volume = 1.0;
  heartBeatAudio.play();
}

function stopHeartBeat() {
  if (heartBeatAudio) {
    heartBeatAudio.pause();
    heartBeatAudio.currentTime = 0;
  }
}

// 检查是否有光点在跳动
function checkHeartBeatSound() {
  const anyHappy = Object.values(sparkleElements).some(
    sparkle => sparkle && sparkle.classList.contains('happy')
  );
  if (anyHappy) {
    playHeartBeat();
  } else {
    stopHeartBeat();
  }
}

function playViolinCello() {
  if (!violinCelloAudio) {
    violinCelloAudio = document.createElement('audio');
    violinCelloAudio.src = 'ViolinCello.mp3';
    violinCelloAudio.loop = true;
    violinCelloAudio.preload = 'auto';
    document.body.appendChild(violinCelloAudio);
  }
  violinCelloAudio.volume = 0.3;
  violinCelloAudio.play();

  // 隐藏所有诗句等文字
  document.querySelectorAll('.poem-text, .sparkle-coordinates, .silver-text').forEach(el => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.5s';
  });
}

function stopViolinCello() {
  if (violinCelloAudio) {
    violinCelloAudio.pause();
    violinCelloAudio.currentTime = 0;
  }
  // 恢复所有诗句等文字
  document.querySelectorAll('.poem-text, .sparkle-coordinates, .silver-text').forEach(el => {
    el.style.opacity = '';
    el.style.transition = '';
  });
}

function checkAndStartOrbit() {
  const ids = Object.keys(sparkleElements).filter(id => {
    const s = sparkleElements[id];
    return s && !s.classList.contains('hidden');
  });
  if (ids.length !== 2) {
    stopOrbit();
    return;
  }
  const s1 = sparkleElements[ids[0]];
  const s2 = sparkleElements[ids[1]];
  const x1 = parseFloat(s1.style.left);
  const y1 = parseFloat(s1.style.top);
  const x2 = parseFloat(s2.style.left);
  const y2 = parseFloat(s2.style.top);
  const dist = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);

  if (!isOrbiting && dist < ORBIT_NEAR_PERCENT) {
    startOrbit(ids, [x1, y1, x2, y2]);
  } else if (isOrbiting && dist > ORBIT_FAR_PERCENT) {
    stopOrbit();
  }
  // 其余情况保持当前状态
}

function startOrbit(ids, basePositions) {
  if (isOrbiting) return;
  isOrbiting = true;
  orbitSparkleIds = ids;
  orbitBasePositions = basePositions;
  playViolinCello();
  let angle = 0;
  const radius = 40;
  function animate() {
    if (!isOrbiting) return;
    angle += 0.03;
    const [x1, y1, x2, y2] = orbitBasePositions;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const s1 = sparkleElements[orbitSparkleIds[0]];
    const s2 = sparkleElements[orbitSparkleIds[1]];
    if (s1 && s2) {
      s1.style.left = `${cx + radius * Math.cos(angle) - 20}px`;
      s1.style.top = `${cy + radius * Math.sin(angle) - 20}px`;
      s2.style.left = `${cx + radius * Math.cos(angle + Math.PI) - 20}px`;
      s2.style.top = `${cy + radius * Math.sin(angle + Math.PI) - 20}px`;
    }
    // 检查两人是否都在笑
    const happy1 = happinessStates[orbitSparkleIds[0]] > 0.8;
    const happy2 = happinessStates[orbitSparkleIds[1]] > 0.8;
    if (happy1 && happy2) {
      // 触发烟花
      const happyColors = [
        s1?.dataset.originalColor,
        s2?.dataset.originalColor
      ].filter(Boolean);
      startContinuousFireworks(happyColors);
    }
    orbitAnimationId = requestAnimationFrame(animate);
  }
  animate();
}

function stopOrbit() {
  if (!isOrbiting) return;
  isOrbiting = false;
  stopViolinCello();
  if (orbitAnimationId) {
    cancelAnimationFrame(orbitAnimationId);
    orbitAnimationId = null;
  }
}

// 取消环绕动画，改为距离检测播放ViolinCello
function checkViolinCelloSound() {
  const ids = Object.keys(sparkleElements).filter(id => {
    const s = sparkleElements[id];
    return s && !s.classList.contains('hidden');
  });
  if (ids.length !== 2) {
    stopViolinCello();
    return;
  }
  const s1 = sparkleElements[ids[0]];
  const s2 = sparkleElements[ids[1]];
  const x1 = parseFloat(s1.style.left) / window.innerWidth;
  const y1 = parseFloat(s1.style.top) / window.innerHeight;
  const x2 = parseFloat(s2.style.left) / window.innerWidth;
  const y2 = parseFloat(s2.style.top) / window.innerHeight;
  const dist = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
  if (dist < ORBIT_NEAR_PERCENT) {
    playViolinCello();
  } else if (dist > ORBIT_FAR_PERCENT) {
    stopViolinCello();
  }
}

function showPoemForDuration(text, duration = 10000) {
  if (poemTimeout) {
    clearTimeout(poemTimeout);
    poemTimeout = null;
  }
  if (poemElement) {
    poemElement.innerHTML = text;
    poemElement.classList.add('visible');
  }
  poemTimeout = setTimeout(() => {
    if (poemElement) {
      poemElement.innerHTML = '';
      poemElement.classList.remove('visible');
    }
    poemTimeout = null;
  }, duration);
}
