import { crearApp } from './app.js';
import { config } from './config.js';

crearApp().listen(config.API_PORT, '127.0.0.1', () => {
  console.log(`API BusinessFlow en http://localhost:${config.API_PORT}/api`);
});
