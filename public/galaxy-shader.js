// Galaxy shader
//
// Created by Frank Hugenroth  /frankenburgh/   07/2015
// Released at nordlicht/bremen 2015

console.log('Galaxy shader script loaded');

const vertexShaderSource = `
  attribute vec4 aVertexPosition;
  void main() {
    gl_Position = aVertexPosition;
  }
`;

const fragmentShaderSource = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  
  #define SCREEN_EFFECT 0

  // random/hash function              
  float hash( float n )
  {
    return fract(cos(n)*41415.92653);
  }

  // 2d noise function
  float noise( in vec2 x )
  {
    vec2 p  = floor(x);
    vec2 f  = smoothstep(0.0, 1.0, fract(x));
    float n = p.x + p.y*57.0;

    return mix(mix( hash(n+  0.0), hash(n+  1.0),f.x),
      mix( hash(n+ 57.0), hash(n+ 58.0),f.x),f.y);
  }

  float noise( in vec3 x )
  {
    vec3 p  = floor(x);
    vec3 f  = smoothstep(0.0, 1.0, fract(x));
    float n = p.x + p.y*57.0 + 113.0*p.z;

    return mix(mix(mix( hash(n+  0.0), hash(n+  1.0),f.x),
      mix( hash(n+ 57.0), hash(n+ 58.0),f.x),f.y),
      mix(mix( hash(n+113.0), hash(n+114.0),f.x),
      mix( hash(n+170.0), hash(n+171.0),f.x),f.y),f.z);
  }

  mat3 m = mat3( 0.00,  1.60,  1.20, -1.60,  0.72, -0.96, -1.20, -0.96,  1.28 );

  // Fractional Brownian motion
  float fbmslow( vec3 p )
  {
    float f = 0.5000*noise( p ); p = m*p*1.2;
    f += 0.2500*noise( p ); p = m*p*1.3;
    f += 0.1666*noise( p ); p = m*p*1.4;
    f += 0.0834*noise( p ); p = m*p*1.84;
    return f;
  }

  float fbm( vec3 p )
  {
    float f = 0., a = 1., s=0.;
    f += a*noise( p ); p = m*p*1.149; s += a; a *= .75;
    f += a*noise( p ); p = m*p*1.41; s += a; a *= .75;
    f += a*noise( p ); p = m*p*1.51; s += a; a *= .65;
    f += a*noise( p ); p = m*p*1.21; s += a; a *= .35;
    f += a*noise( p ); p = m*p*1.41; s += a; a *= .75;
    f += a*noise( p ); 
    return f/s;
  }

  void main() {
    float time = iTime * 0.1;
    vec2 fragCoord = gl_FragCoord.xy;
    vec4 fragColor;

    vec2 xy = -1.0 + 2.0*fragCoord.xy / iResolution.xy;

    // 移除淡出效果，保持永久显示
    float fade = 1.0;
    // start glow after 5=50sec
    float fade2= max(0., time-10.)*0.37;
    float glow = max(-.25,1.+pow(fade2, 10.) - 0.001*pow(fade2, 25.));
    
    // get camera position and view direction
    vec3 campos = vec3(200.0, 350., -.0-cos((time-1.4)/2.)*800.); // 减小相机距离
    vec3 camtar = vec3(0., 0., 0.);
    
    float roll = 0.34;
    vec3 cw = normalize(camtar-campos);
    vec3 cp = vec3(sin(roll), cos(roll),0.0);
    vec3 cu = normalize(cross(cw,cp));
    vec3 cv = normalize(cross(cu,cw));
    vec3 rd = normalize( xy.x*cu + xy.y*cv + 1.6*cw );

    vec3 light   = normalize( vec3(  0., 0.,  0. )-campos );
    float sundot = clamp(dot(light,rd),0.0,1.0);

    // render sky
    // galaxy center glow
    vec3 col = glow*0.6*min(vec3(1.0, 1.0, 1.0), vec3(2.0,1.0,0.5)*pow( sundot, 100.0 )); // 减小光晕强度
    // moon haze
    col += 0.15*vec3(0.8,0.9,1.2)*pow( sundot, 8.0 ); // 减小光晕强度

    // stars
    vec3 stars = 85.5*vec3(pow(fbmslow(rd.xyz*312.0), 7.0))*vec3(pow(fbmslow(rd.zxy*440.3), 8.0));
    
    // moving background fog
    vec3 cpos = 1500.*rd + vec3(831.0-time*30., 321.0, 1000.0);
    col += vec3(0.4, 0.5, 1.0) * ((fbmslow( cpos*0.0035 ) - .5));

    cpos += vec3(831.0-time*33., 321.0, 999.);
    col += vec3(0.6, 0.3, 0.6) * 10.0*pow((fbmslow( cpos*0.0045 )), 10.0);

    cpos += vec3(3831.0-time*39., 221.0, 999.0);
    col += 0.03*vec3(0.6, 0.0, 0.0) * 10.0*pow((fbmslow( cpos*0.0145 )), 2.0);

    // stars
    cpos = 1500.*rd + vec3(831.0, 321.0, 999.);
    col += stars*fbm(cpos*0.0021);
    
    // Clouds
    vec2 shift = vec2( time*100.0, time*180.0 );
    vec4 sum = vec4(0,0,0,0); 
    float c = campos.y / rd.y; // cloud height
    vec3 cpos2 = campos - c*rd;
    float radius = length(cpos2.xz)/400.0; // 减小云层半径

    if (radius<0.8) // 减小云层范围
    {
      for (int q=10; q>-10; q--) // layers
      {
        if (sum.w>0.999) continue;
        float c = (float(q)*8.-campos.y) / rd.y; // cloud height
        vec3 cpos = campos + c*rd;

        float see = dot(normalize(cpos), normalize(campos));
        vec3 lightUnvis = vec3(.0,.0,.0 );
        vec3 lightVis   = vec3(1.3,1.2,1.2 );
        vec3 shine = mix(lightVis, lightUnvis, smoothstep(0.0, 1.0, see));

        // border
        float radius = length(cpos.xz)/400.; // 减小云层半径
        if (radius>0.5) // 减小云层范围
          continue;

        float rot = 3.00*(radius)-time;
        cpos.xz = cpos.xz*mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
    
        cpos += vec3(831.0+shift.x, 321.0+float(q)*mix(250.0, 50.0, radius)-shift.x*0.2, 1330.0+shift.y); // cloud position
        cpos *= mix(0.0025, 0.0028, radius); // zoom
        float alpha = smoothstep(0.50, 1.0, fbm( cpos )); // fractal cloud density
        alpha *= 1.3*pow(smoothstep(1.0, 0.0, radius), 0.3); // fade out disc at edges
        vec3 dustcolor = mix(vec3( 2.0, 1.3, 1.0 ), vec3( 0.1,0.2,0.3 ), pow(radius, .5));
        vec3 localcolor = mix(dustcolor, shine, alpha); // density color white->gray
          
        float gstar = 2.*pow(noise( cpos*21.40 ), 22.0);
        float gstar2= 3.*pow(noise( cpos*26.55 ), 34.0);
        float gholes= 1.*pow(noise( cpos*11.55 ), 14.0);
        localcolor += vec3(1.0, 0.6, 0.3)*gstar;
        localcolor += vec3(1.0, 1.0, 0.7)*gstar2;
        localcolor -= gholes;
          
        alpha = (1.0-sum.w)*alpha; // alpha/density saturation
        sum += vec4(localcolor*alpha, alpha); // sum up weightened color
      }
        
      for (int q=0; q<20; q++) // 120 layers
      {
        if (sum.w>0.999) continue;
        float c = (float(q)*4.-campos.y) / rd.y; // cloud height
        vec3 cpos = campos + c*rd;

        float see = dot(normalize(cpos), normalize(campos));
        vec3 lightUnvis = vec3(.0,.0,.0 );
        vec3 lightVis   = vec3(1.3,1.2,1.2 );
        vec3 shine = mix(lightVis, lightUnvis, smoothstep(0.0, 1.0, see));

        // border
        float radius = length(cpos.xz)/200.0;
        if (radius>1.0)
          continue;

        float rot = 3.2*(radius)-time*1.1;
        cpos.xz = cpos.xz*mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
    
        cpos += vec3(831.0+shift.x, 321.0+float(q)*mix(250.0, 50.0, radius)-shift.x*0.2, 1330.0+shift.y); // cloud position
        float alpha = 0.1+smoothstep(0.6, 1.0, fbm( cpos )); // fractal cloud density
        alpha *= 1.2*(pow(smoothstep(1.0, 0.0, radius), 0.72) - pow(smoothstep(1.0, 0.0, radius*1.875), 0.2)); // fade out disc at edges
        vec3 localcolor = vec3(0.0, 0.0, 0.0); // density color white->gray
  
        alpha = (1.0-sum.w)*alpha; // alpha/density saturation
        sum += vec4(localcolor*alpha, alpha); // sum up weightened color
      }
    }
    float alpha = smoothstep(1.-radius*.5, 1.0, sum.w);
    sum.rgb /= sum.w+0.0001;
    sum.rgb -= 0.2*vec3(0.8, 0.75, 0.7) * pow(sundot,10.0)*alpha;
    sum.rgb += min(glow, 10.0)*0.2*vec3(1.2, 1.2, 1.2) * pow(sundot,5.0)*(1.0-alpha);

    col = mix( col, sum.rgb , sum.w);

    // haze
    col = fade*mix(col, vec3(0.3,0.5,.9), 29.0*(pow( sundot, 50.0 )-pow( sundot, 60.0 ))/(2.+9.*abs(rd.y)));

    #if SCREEN_EFFECT == 1
    if (time<2.5)
    {
      // screen effect
      float c = (col.r+col.g+col.b)* .3 * (.6+.3*cos(gl_FragCoord.y*1.2543)) + .1*(noise((xy+time*2.)*294.)*noise((xy-time*3.)*321.));
      c += max(0.,.08*sin(10.*time+xy.y*7.2543));
      // flicker
      col = vec3(c, c, c) * (1.-0.5*pow(noise(vec2(time*99., 0.)), 9.));
    }
    else
    {
      // bam
      float c = clamp(1.-(time-2.5)*6., 0., 1. );
      col = mix(col, vec3(1.,1.,1.),c);
    }
    #endif
    
    // Vignetting
    vec2 xy2 = gl_FragCoord.xy / iResolution.xy;
    col *= vec3(.5, .5, .5) + 0.25*pow(100.0*xy2.x*xy2.y*(1.0-xy2.x)*(1.0-xy2.y), .5 );  

    gl_FragColor = vec4(col,1.0);
  }
`;

let gl;
let program;
let startTime;

function initGalaxyShader() {
  console.log('初始化星系着色器...');
  
  // 创建canvas元素
  const canvas = document.createElement('canvas');
  canvas.id = 'galaxy-canvas';
  
  // 设置canvas样式
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.zIndex = '-9999';
  canvas.style.pointerEvents = 'none';
  canvas.style.background = 'transparent';
  
  // 添加到body的最前面
  document.body.insertBefore(canvas, document.body.firstChild);
  
  // 设置canvas尺寸
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  
  console.log('Canvas尺寸:', canvas.width, 'x', canvas.height);
  console.log('Canvas样式:', {
    position: canvas.style.position,
    zIndex: canvas.style.zIndex,
    background: canvas.style.background,
    pointerEvents: canvas.style.pointerEvents
  });
  
  // 获取WebGL上下文
  gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: true
  });
  
  if (!gl) {
    console.error('无法获取WebGL上下文');
    return;
  }
  
  console.log('WebGL上下文创建成功');
  
  // 设置清除颜色为透明
  gl.clearColor(0.0, 0.0, 0.0, 0.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  
  // 创建着色器程序
  program = createShaderProgram(gl);
  if (!program) {
    console.error('着色器程序创建失败');
    return;
  }
  
  console.log('着色器程序创建成功');
  
  // 开始渲染循环
  startTime = Date.now();
  render();
  console.log('渲染循环已启动');
}

function render() {
  if (!gl || !program) {
    console.error('WebGL上下文或着色器程序未初始化');
    return;
  }

  const time = (Date.now() - startTime) / 1000;
  
  // 设置视口
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  
  // 使用着色器程序
  gl.useProgram(program);
  
  // 设置分辨率
  const resolutionLocation = gl.getUniformLocation(program, 'iResolution');
  gl.uniform2f(resolutionLocation, gl.canvas.width, gl.canvas.height);
  
  // 设置时间
  const timeLocation = gl.getUniformLocation(program, 'iTime');
  gl.uniform1f(timeLocation, time);
  
  // 清除画布
  gl.clearColor(0.0, 0.0, 0.0, 1.0); // 改为不透明黑色
  gl.clear(gl.COLOR_BUFFER_BIT);
  
  // 绘制
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  
  // 检查WebGL错误
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    console.error('WebGL错误:', error);
  }
  
  // 每100帧输出一次调试信息
  if (Math.floor(time * 60) % 100 === 0) {
    console.log('渲染状态:', {
      canvasSize: `${gl.canvas.width}x${gl.canvas.height}`,
      time: time,
      error: error === gl.NO_ERROR ? '无错误' : error
    });
  }
  
  // 继续渲染循环
  requestAnimationFrame(render);
}

function createShaderProgram(gl) {
  // 创建着色器程序
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vertexShader, vertexShaderSource);
  gl.compileShader(vertexShader);
  
  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    console.error('顶点着色器编译错误:', gl.getShaderInfoLog(vertexShader));
    return null;
  }
  
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fragmentShader, fragmentShaderSource);
  gl.compileShader(fragmentShader);
  
  if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
    console.error('片段着色器编译错误:', gl.getShaderInfoLog(fragmentShader));
    return null;
  }
  
  console.log('Shaders compiled successfully');
  
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('无法初始化着色器程序:', gl.getProgramInfoLog(program));
    return null;
  }
  
  console.log('Shader program linked successfully');
  
  // 创建顶点缓冲区
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1.0, -1.0,
     1.0, -1.0,
    -1.0,  1.0,
     1.0,  1.0,
  ]), gl.STATIC_DRAW);
  
  const positionLocation = gl.getAttribLocation(program, 'aVertexPosition');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  
  return program;
}

// 确保在DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM加载完成，准备初始化着色器');
  initGalaxyShader();
});

// 添加窗口大小改变事件监听
window.addEventListener('resize', () => {
  console.log('Window resized');
  const canvas = document.getElementById('galaxy-canvas');
  if (canvas) {
    console.log('Resizing canvas to:', window.innerWidth, 'x', window.innerHeight);
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
}); 