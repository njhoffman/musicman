import React from 'react';
import PropTypes from 'prop-types';

// build variables from .env file
const {
  NODE_ENV,
  REACT_APP_LOG_LEVEL = 'debug',
  REACT_APP_SERVER_URL = 'http://localhost:3000/graphql-dev',
} = process.env;

export const defaultConfig = {
  apiEnv: '',
  version: '',
  env: NODE_ENV,
  logLevel: REACT_APP_LOG_LEVEL,
  apiUrl: REACT_APP_SERVER_URL,
};

export const ConfigContext = React.createContext();

export const ConfigProvider = ({ children }) => {
  return <ConfigContext.Provider value={{ ...defaultConfig }}>{children}</ConfigContext.Provider>;
};

ConfigProvider.propTypes = {
  children: PropTypes.oneOfType([PropTypes.arrayOf(PropTypes.node), PropTypes.node]),
};

export default ConfigProvider;
