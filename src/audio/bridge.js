import { SessionManager } from '../gemini/session.js';

export class ESP32GeminiBridge {
  constructor(vectorStore) {
    this.esp32Connections = new Map();
    this.sessionManager = new SessionManager(vectorStore);
    this.vectorStore = vectorStore;
  }

  async handleESP32Connection(ws, deviceId) {
    console.log(`[BRIDGE] ESP32 device ${deviceId} connected`);

    this.esp32Connections.set(deviceId, ws);

    try {
      const session = await this.sessionManager.createSession(deviceId);

      session.onAudioOutput = (audioData, mimeType) => {
        this.sendAudioToESP32(deviceId, audioData, mimeType);
      };

      session.onTurnComplete = () => {
        this.sendControlMessage(deviceId, 'turn_complete');
      };

      session.onInterrupted = () => {
        this.sendControlMessage(deviceId, 'interrupted');
      };

      this.sendHandshakeAck(ws, session.sessionId);
      this.setupESP32Handlers(ws, deviceId, session.sessionId);

    } catch (error) {
      console.error(`[BRIDGE] Failed to create session for ESP32 ${deviceId}:`, error);
      this.sendError(ws, 'SESSION_CREATION_FAILED', error.message);
    }
  }

  setupESP32Handlers(ws, deviceId, sessionId) {
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        await this.handleESP32Message(deviceId, sessionId, message);
      } catch (error) {
        console.error(`[BRIDGE] Error handling ESP32 message:`, error);
        this.sendError(ws, 'MESSAGE_PROCESSING_ERROR', error.message);
      }
    });

    ws.on('close', () => {
      console.log(`[BRIDGE] ESP32 device ${deviceId} disconnected`);
      this.handleESP32Disconnect(deviceId);
    });

    ws.on('error', (error) => {
      console.error(`[BRIDGE] ESP32 WebSocket error for ${deviceId}:`, error);
    });

    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
  }

  async handleESP32Message(deviceId, sessionId, message) {
    switch (message.type) {
      case 'audio_input':
        await this.handleAudioInput(sessionId, message.data);
        break;

      case 'control':
        await this.handleControlCommand(sessionId, message);
        break;

      case 'status':
        this.handleStatusUpdate(deviceId, message.data);
        break;

      case 'navigate':
        await this.handleNavigation(sessionId, message);
        break;

      default:
        console.warn(`[BRIDGE] Unknown message type from ESP32: ${message.type}`);
    }
  }

  async handleAudioInput(sessionId, data) {
    console.log('\n🌉 [BRIDGE-INPUT] === AUDIO INPUT RECEIVED ===');
    console.log('[BRIDGE-INPUT] - Session ID:', sessionId);
    console.log('[BRIDGE-INPUT] - Has audio data:', !!data.audio);
    console.log('[BRIDGE-INPUT] - Audio data length:', data.audio?.length || 0);
    console.log('[BRIDGE-INPUT] - MIME type:', data.mimeType);
    console.log('[BRIDGE-INPUT] - Timestamp:', data.timestamp);
    console.log('[BRIDGE-INPUT] - Audio data type:', typeof data.audio);
    console.log('[BRIDGE-INPUT] - First 30 chars of audio:', data.audio?.substring(0, 30));

    if (!data.audio) {
      console.error('[BRIDGE-INPUT] ❌ No audio data in message');
      return;
    }

    if (data.mimeType && !data.mimeType.includes('16000')) {
      console.warn('[BRIDGE-INPUT] ⚠️ Audio may not be at required 16kHz sample rate:', data.mimeType);
    }

    try {
      console.log('[BRIDGE-INPUT] ➡️ Forwarding audio to session manager...');
      await this.sessionManager.sendAudioInput(sessionId, data.audio);
      console.log('[BRIDGE-INPUT] ✅ Audio forwarded to session manager successfully');
      console.log('[BRIDGE-INPUT] === AUDIO INPUT PROCESSED ===\n');
    } catch (error) {
      console.error('[BRIDGE-INPUT] ❌ Failed to send audio to Gemini');
      console.error('[BRIDGE-INPUT] Error:', error.message);
      console.error('[BRIDGE-INPUT] Stack:', error.stack);
      console.error('[BRIDGE-INPUT] === AUDIO INPUT FAILED ===\n');
    }
  }

  sendAudioToESP32(deviceId, audioData, mimeType) {
    console.log('[BRIDGE-AUDIO] sendAudioToESP32 called:');
    console.log('[BRIDGE-AUDIO] - Device ID:', deviceId);
    console.log('[BRIDGE-AUDIO] - Audio data length:', audioData?.length || 0);
    console.log('[BRIDGE-AUDIO] - MIME type:', mimeType);

    const ws = this.esp32Connections.get(deviceId);

    if (!ws) {
      console.error('[BRIDGE-AUDIO] ❌ No WebSocket connection found for device:', deviceId);
      return;
    }

    if (ws.readyState !== ws.OPEN) {
      console.error('[BRIDGE-AUDIO] ❌ WebSocket not open for device:', deviceId, 'State:', ws.readyState);
      return;
    }

    const message = {
      type: 'audio_output',
      data: {
        audio: audioData,
        mimeType: mimeType || 'audio/pcm;rate=24000',
        timestamp: Date.now()
      }
    };

    console.log('[BRIDGE-AUDIO] Sending audio message to ESP32');
    ws.send(JSON.stringify(message));
    console.log('[BRIDGE-AUDIO] ✅ Audio message sent to ESP32');
  }

  async handleControlCommand(sessionId, message) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return;

    switch (message.command) {
      case 'start_session':
        session.status = 'active';
        session.context.mode = message.data?.mode || 'conversation';
        break;

      case 'stop_session':
        session.status = 'stopped';
        session.audioQueue = [];
        break;

      case 'pause':
        session.status = 'paused';
        break;

      case 'resume':
        session.status = 'active';
        break;

      default:
        console.warn(`[BRIDGE] Unknown control command: ${message.command}`);
    }
  }

  async handleNavigation(sessionId, message) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return;

    switch (message.command) {
      case 'next':
      case 'previous':
        break;

      case 'goto':
        if (message.data?.target) {
          session.context.currentChapter = message.data.target.chapter;
          session.context.currentSection = message.data.target.section;
        }
        break;
    }
  }

  handleStatusUpdate(deviceId, statusData) {
    console.log(`[BRIDGE] ESP32 ${deviceId} status:`, statusData);
  }

  handleESP32Disconnect(deviceId) {
    this.esp32Connections.delete(deviceId);

    const session = this.sessionManager.findSessionByDevice(deviceId);
    if (session) {
      session.status = 'disconnected';
      console.log(`[BRIDGE] ESP32 ${deviceId} disconnected, session ${session.sessionId} preserved`);
    }
  }

  sendHandshakeAck(ws, sessionId) {
    const message = {
      type: 'handshake_ack',
      data: {
        sessionId: sessionId,
        serverCapabilities: {
          maxAudioChunkSize: 4096,
          supportedFormats: ['pcm16'],
          inputSampleRate: 16000,
          outputSampleRate: 24000,
          timeout: parseInt(process.env.SESSION_TIMEOUT || '900000')
        },
        timestamp: Date.now()
      }
    };

    ws.send(JSON.stringify(message));
  }

  sendControlMessage(deviceId, command, data = {}) {
    const ws = this.esp32Connections.get(deviceId);
    if (!ws || ws.readyState !== ws.OPEN) return;

    const message = {
      type: 'control',
      command: command,
      data: data,
      timestamp: Date.now()
    };

    ws.send(JSON.stringify(message));
  }

  sendError(ws, code, message) {
    if (ws.readyState !== ws.OPEN) return;

    const errorMessage = {
      type: 'error',
      data: {
        code: code,
        message: message,
        timestamp: Date.now()
      }
    };

    ws.send(JSON.stringify(errorMessage));
  }

  sendStatus(deviceId, state, message = '') {
    const ws = this.esp32Connections.get(deviceId);
    if (!ws || ws.readyState !== ws.OPEN) return;

    const statusMessage = {
      type: 'status',
      data: {
        state: state,
        message: message,
        timestamp: Date.now()
      }
    };

    ws.send(JSON.stringify(statusMessage));
  }

  getStats() {
    return {
      connectedDevices: this.esp32Connections.size,
      devices: Array.from(this.esp32Connections.keys()),
      sessions: this.sessionManager.getSessionStats()
    };
  }

  cleanup() {
    this.sessionManager.cleanup();
  }
}