import React, { useContext } from 'react';

import { makeStyles } from '@material-ui/core/styles';
import FormControl from '@material-ui/core/FormControl';
import FormGroup from '@material-ui/core/FormGroup';
import FormLabel from '@material-ui/core/FormLabel';
import Container from '@material-ui/core/Container';
import Box from '@material-ui/core/Box';
import Typography from '@material-ui/core/Typography';
import Button from '@material-ui/core/Button';

import { SocketContext } from './utils/contexts/Socket';

import './App.css';

const useStyles = makeStyles(theme => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    border: 'solid 1px white',
  },
  playerBox: {
    width: '100%',
    display: 'flex',
    border: 'solid 1px #888',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  groupBox: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-evenly',
  },
  formControl: {
    margin: theme.spacing(1),
    display: 'inline-block',
    border: 'solid 1px #888',
  },
  formGroup: {
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  button: {
    margin: theme.spacing(1),
  },
}));

const mockData = {
  groups: [
    [
      {
        name: 'Context',
        width: 50,
        buttonWidth: 40,
        direction: 'row',
        options: ['Pool', 'Drive', 'Lounge', 'Study', 'Relax', 'Run', 'Lift', 'Code', 'Smoke'],
      },
      {
        name: 'Mood',
        width: 40,
        buttonWidth: 80,
        direction: 'column',
        options: ['Upbeat', 'Intense', 'Dreamy', 'Mellow', 'Very Mellow', 'Gloomy'],
      },
    ],
    [
      {
        name: 'Picks',
        width: 100,
        buttonWidth: 20,
        direction: 'row',
        options: ['Nick', 'Jakob', 'Cole'],
      },
    ],
  ],
};

const App = () => {
  const classes = useStyles();
  const currentSong = useContext(SocketContext);

  return (
    <Container maxWidth="sm" className={classes.root}>
      <Box className={classes.playerBox}>
        <Box>
          <Typography>{currentSong.title}</Typography>
          <Typography>{currentSong.artist}</Typography>
          <Typography>{currentSong.time}</Typography>
        </Box>
        <Box>
          <Button>&lt;&lt;</Button>
          <Button>&lt;</Button>
          <Button>Play</Button>
          <Button>&gt;</Button>
          <Button>&gt;&gt;</Button>
        </Box>
      </Box>
      {mockData.groups.map(row => (
        <Box className={classes.groupBox}>
          {row.map(group => (
            <FormControl
              style={{ width: `calc(${group.width}% - 8px)` }}
              component="fieldset"
              className={classes.formControl}
            >
              <FormLabel component="legend">{group.name}</FormLabel>
              <FormGroup style={{ flexDirection: group.direction }} className={classes.formGroup}>
                {group.options.map(option => (
                  <Button
                    style={{ width: `calc(${group.buttonWidth}% - 8px)` }}
                    variant="outlined"
                    color="primary"
                    className={classes.button}
                  >
                    {option}
                  </Button>
                ))}
              </FormGroup>
            </FormControl>
          ))}
        </Box>
      ))}
    </Container>
  );
};
export default App;
