let io;
const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = {
  init: (httpServer, corsOrigin) => {
    io = require('socket.io')(httpServer, {
      cors: {
        origin: corsOrigin,
        methods: ['GET', 'POST', 'PUT', 'DELETE']
      }
    });

    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth && socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication required'));

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('_id role');
        if (!user) return next(new Error('Authentication required'));

        socket.data.user = { id: String(user._id), role: user.role };
        return next();
      } catch {
        return next(new Error('Authentication required'));
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
