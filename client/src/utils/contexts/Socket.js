import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import initializeWebSocket from '../../websocket';

const currentSong = {
  artist: 'Test Artist',
  title: 'Test Title',
  time: 0,
};

export const SocketContext = React.createContext(currentSong);

export const SocketProvider = ({ children }) => {
  const [value, setValue] = useState(currentSong);

  useEffect(() => initializeWebSocket({ setValue }), []);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};

SocketProvider.propTypes = {
  children: PropTypes.oneOfType([PropTypes.arrayOf(PropTypes.node), PropTypes.node]).isRequired,
};

export default SocketProvider;
