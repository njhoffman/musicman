const initServer = require('../lib/server');
const request = require('supertest');

const setupApp = async() => {
  const app = await initServer();
  return app;
};

const postRequest = (app, url, params) =>
  new Promise((resolve, reject) => {
    request(app)
      .post(url)
      .send(params)
      .end((err, res) => {
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      });
  });

const getRequest = (app, url) =>
  new Promise((resolve, reject) => {
    request(app)
      .get(url)
      .end((err, res) => {
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      });
  });


module.exports = { setupApp, postRequest, getRequest };
