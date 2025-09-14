#!/usr/bin/env node

import { WebSocketServer } from 'ws';
import { ESP32GeminiBridge } from './audio/bridge.js';
import { VectorStore } from './vector/store.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BodhikaServer {
  constructor(port = process.env.PORT || 8080) {
    this.port = port;
    this.wss = null;
    this.bridge = null;
    this.vectorStore = null;
  }

  async loadTextbookData() {
    console.log('📚 [SERVER] Loading textbook data...');

    try {
      const textbookPath = path.join(__dirname, '..', 'data', 'textbook.json');
      const textbookData = await fs.readFile(textbookPath, 'utf-8');
      const parsedData = JSON.parse(textbookData);

      this.vectorStore = new VectorStore();
      await this.vectorStore.loadFromJSON(parsedData);

      console.log('✅ [SERVER] Textbook data loaded successfully');
      console.log(`📊 [SERVER] Loaded ${parsedData.chunks?.length || 0} text chunks`);

      return this.vectorStore;
    } catch (error) {
      console.warn('⚠️ [SERVER] Could not load textbook.json:', error.message);
      console.log('📝 [SERVER] Server will run without textbook search capability');
      console.log('💡 [SERVER] Copy textbook.json from indexer project to /server/data/ folder');
      return null;
    }
  }

  async start() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 BODHIKA AI SCIENCE TEACHER SERVER');
    console.log('='.repeat(60));
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📍 Process ID: ${process.pid}`);
    console.log(`📍 Node Version: ${process.version}`);
    console.log(`📍 Platform: ${process.platform}`);
    console.log(`📍 Working Directory: ${process.cwd()}`);
    console.log('='.repeat(60) + '\n');

    await this.loadTextbookData();

    this.bridge = new ESP32GeminiBridge(this.vectorStore);

    console.log('🚀 [SERVER] Starting WebSocket server...');
    console.log(`📍 [SERVER] Port: ${this.port}`);
    console.log(`📍 [SERVER] Compression: Disabled for audio`);

    this.wss = new WebSocketServer({
      port: this.port,
      perMessageDeflate: false
    });

    console.log(`✅ [SERVER] WebSocket server listening on port ${this.port}`);
    console.log(`🔗 [SERVER] URL: ws://localhost:${this.port}`);

    this.wss.on('connection', (ws, req) => {
      console.log('\n🔌 [SERVER] New connection initiated');
      console.log(`📍 [SERVER] Request URL: ${req.url}`);
      this.handleConnection(ws, req);
    });

    this.wss.on('error', (error) => {
      console.error('\n❌ [SERVER] Server error:', error);
      console.error(`📍 [SERVER] Error stack:`, error.stack);
    });

    return this.wss;
  }

  handleConnection(ws, req) {
    console.log('\n🔄 [SERVER] Processing new connection...');
    console.log(`📍 [SERVER] Remote address: ${req.socket.remoteAddress}`);
    console.log(`📍 [SERVER] Remote port: ${req.socket.remotePort}`);

    const deviceId = this.extractDeviceId(req);
    console.log(`🔑 [SERVER] Extracted device ID: ${deviceId}`);

    if (!deviceId) {
      console.error('\n❌ [SERVER] No device ID provided');
      const errorMsg = {
        type: 'error',
        data: {
          code: 'MISSING_DEVICE_ID',
          message: 'Device ID is required'
        }
      };
      ws.send(JSON.stringify(errorMsg));
      ws.close();
      return;
    }

    console.log(`⏳ [SERVER] Waiting for handshake from device ${deviceId}...`);
    ws.once('message', async (data) => {
      console.log(`\n📥 [SERVER] First message received from ${deviceId}`);
      try {
        const message = JSON.parse(data.toString());
        console.log(`📍 [SERVER] Message type: ${message.type}`);

        if (message.type === 'handshake') {
          console.log(`🤝 [SERVER] Handshake message confirmed, processing...`);
          await this.handleHandshake(ws, message.data);
        } else {
          console.error(`\n❌ [SERVER] First message was not handshake, got: ${message.type}`);
          ws.close();
        }
      } catch (error) {
        console.error('\n❌ [SERVER] Handshake error:', error);
        ws.close();
      }
    });

    ws.on('error', (error) => {
      console.error(`\n❌ [SERVER] WebSocket error for device ${deviceId}:`, error.message);
    });

    ws.on('close', (code, reason) => {
      console.log(`\n🔒 [SERVER] Connection closed for device ${deviceId}`);
      console.log(`📍 [SERVER] Close code: ${code}`);
      console.log(`📍 [SERVER] Close reason: ${reason || 'No reason provided'}`);
    });
  }

  async handleHandshake(ws, handshakeData) {
    const { deviceId, deviceType, capabilities, version } = handshakeData;

    console.log(`\n🤝 [SERVER] Processing handshake...`);
    console.log(`📍 [SERVER] Device ID: ${deviceId}`);
    console.log(`📍 [SERVER] Device Type: ${deviceType}`);
    console.log(`📍 [SERVER] Version: ${version}`);
    console.log(`📍 [SERVER] Capabilities:`, JSON.stringify(capabilities, null, 2));

    if (!this.validateCapabilities(capabilities)) {
      console.error(`\n❌ [SERVER] Device capabilities validation failed`);
      const errorMsg = {
        type: 'error',
        data: {
          code: 'INVALID_CAPABILITIES',
          message: 'Device capabilities not supported'
        }
      };
      ws.send(JSON.stringify(errorMsg));
      ws.close();
      return;
    }
    console.log(`✅ [SERVER] Capabilities validated successfully`);

    console.log(`\n🌉 [SERVER] Passing connection to ESP32 bridge...`);
    await this.bridge.handleESP32Connection(ws, deviceId);
    console.log(`✅ [SERVER] Connection handed over to bridge`);
  }

  validateCapabilities(capabilities) {
    console.log(`\n🔍 [SERVER] Validating capabilities...`);
    if (!capabilities) {
      console.error(`❌ [SERVER] No capabilities provided`);
      return false;
    }

    console.log(`📍 [SERVER] Checking audio format: ${capabilities.audioFormat}`);
    if (capabilities.audioFormat !== 'pcm16') {
      console.error(`❌ [SERVER] Unsupported audio format: ${capabilities.audioFormat}`);
      return false;
    }
    console.log(`✅ [SERVER] Audio format OK: pcm16`);

    console.log(`📍 [SERVER] Checking sample rate: ${capabilities.sampleRate}`);
    if (capabilities.sampleRate &&
        capabilities.sampleRate !== 16000 &&
        capabilities.sampleRate !== 24000) {
      console.warn(`⚠️ [SERVER] Non-standard sample rate: ${capabilities.sampleRate}`);
    } else {
      console.log(`✅ [SERVER] Sample rate OK: ${capabilities.sampleRate}`);
    }

    console.log(`✅ [SERVER] All capabilities validated`);
    return true;
  }

  extractDeviceId(req) {
    console.log(`\n🔍 [SERVER] Extracting device ID...`);

    const url = new URL(req.url, `http://${req.headers.host}`);
    const deviceId = url.searchParams.get('device_id');

    if (deviceId) {
      console.log(`✅ [SERVER] Device ID found in query params: ${deviceId}`);
      return deviceId;
    }

    if (req.headers['x-device-id']) {
      console.log(`✅ [SERVER] Device ID found in headers: ${req.headers['x-device-id']}`);
      return req.headers['x-device-id'];
    }

    const generatedId = `device_${Date.now()}`;
    console.log(`⚠️ [SERVER] Generated fallback device ID: ${generatedId}`);
    return generatedId;
  }

  stop() {
    if (this.wss) {
      this.wss.close(() => {
        console.log('WebSocket server stopped');
      });
    }
    if (this.bridge) {
      this.bridge.cleanup();
    }
  }

  getStats() {
    if (!this.wss) return null;

    return {
      clients: this.wss.clients.size,
      bridgeStats: this.bridge ? this.bridge.getStats() : null
    };
  }
}

const port = process.env.PORT || process.env.WS_PORT || 8080;
const server = new BodhikaServer(port);
await server.start();

process.on('SIGTERM', () => {
  console.log('\n⛔ [SERVER] SIGTERM received, shutting down gracefully...');
  server.stop();
  console.log('👋 [SERVER] Goodbye!');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n⛔ [SERVER] SIGINT received, shutting down gracefully...');
  server.stop();
  console.log('👋 [SERVER] Goodbye!');
  process.exit(0);
});

console.log('✅ [SERVER] Bodhika AI Science Teacher server is running');
console.log(`🔗 [SERVER] Listening on ws://localhost:${port}`);
console.log(`⏰ [SERVER] Started at: ${new Date().toISOString()}`);
console.log('\n' + '='.repeat(60) + '\n');