let io;

module.exports = {
  init: (httpServer) => {
    io = require('socket.io')(httpServer, {
      cors: {
        origin: '*', // Allow all origins for dev
        methods: ['GET', 'POST', 'PUT', 'DELETE']
      }
    });
    
    io.on('connection', (socket) => {
      console.log('Client connected');
      socket.on('disconnect', () => {
        console.log('Client disconnected');
      });
    });
    
    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io not initialized');
    }
    return io;
  }
};
