/* Step 1.1. Establish an express app*/
let express = require('express');
let app = express();
app.use('/', express.static('public'));

/* Step 1.3. Get access to the file system*/
let fs = require('fs');

/* Step 1.4. 修改为 HTTP 服务器 */
let http = require('http'); // 使用 http 模块
let port = process.env.PORT || 3000; // Glitch 使用 PORT 环境变量（必须大写）

// 创建 HTTP 服务器
let server = http.createServer(app);

// 启动服务器
server.listen(port, () => {
  console.log('Server listening on port', port);
});

/*STEP 2. Peers object to store peer ids*/
let peers = {};

/*STEP 3. Create a web socket server to send signaling messages*/
let io = require('socket.io');
io = new io.Server(server); // 绑定到 HTTP 服务器

io.sockets.on('connection', (socket) => {
  console.log('We have a new client: ', socket.id);
  /*STEP 3.1. Add socket to 'peers' object*/
  peers[socket.id] = socket;

  /*STEP 6.3. Listen and get all peer ids*/
  socket.on('list', () => {
    //get an ids array
    let ids = Object.keys(peers);
    console.log(ids);

    //send all existing socket ids to this specific socket
    socket.emit('listresults', ids);
  });

  /*STEP 7.3. Relay signals back and forth*/
  socket.on('signal', (to, from, data) => {
    console.log('signal', to);

    //check if such peer exists in a 'peers' object
    if(to in peers){
      //send signal to that peer
      peers[to].emit('signal', to, from, data);
    }else{
      console.log('Peer not found');
    };
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected: ', socket.id);

    io.emit('peer_disconnect', socket.id);

    /*STEP 3.2. Delete from 'peers' object*/
    delete peers[socket.id];
  });
});