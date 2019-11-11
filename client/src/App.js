import React, { useEffect } from 'react';

import Container from '@material-ui/core/Container';
import Typography from '@material-ui/core/Typography';
import Box from '@material-ui/core/Box';
import Link from '@material-ui/core/Link';

import initializeWebSocket from './websocket';

import logo from './logo.svg';
import './App.css';

const Copyright = () => {
  return (
    <Typography variant="body2" color="textSecondary" align="center">
      <img src={logo} className="App-logo" alt="logo" />
      Edit <code>src/App.js</code> and save to reload.
      {'Copyright © '}
      <Link color="inherit" href="https://material-ui.com/">
        Your Website
      </Link>{' '}
      {new Date().getFullYear()}
      {'.'}
    </Typography>
  );
};

export default function App() {
  useEffect(() => {
    initializeWebSocket();
  });

  return (
    <Container maxWidth="sm" className="App">
      <Box my={4}>
        <Typography variant="h4" component="h1" gutterBottom>
          Create React App v4-beta example
        </Typography>
        <Copyright />
      </Box>
    </Container>
  );
}
