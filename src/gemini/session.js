import { v4 as uuidv4 } from 'uuid';
import { GeminiLiveClient } from './client.js';

export class SessionManager {
  constructor(vectorStore) {
    this.sessions = new Map();
    this.geminiClient = new GeminiLiveClient(vectorStore);
    this.sessionTimeout = parseInt(process.env.SESSION_TIMEOUT || '900000');
    this.maxSessions = parseInt(process.env.MAX_SESSIONS || '100');
    this.vectorStore = vectorStore;

    setInterval(() => this.cleanupSessions(), 60000);
  }

  async createSession(deviceId) {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error('Maximum session limit reached');
    }

    const existingSession = this.findSessionByDevice(deviceId);
    if (existingSession) {
      return existingSession;
    }

    const sessionId = uuidv4();
    const sessionData = {
      sessionId,
      deviceId,
      geminiSession: null,
      resumptionToken: null,
      context: {
        currentChapter: null,
        currentSection: null,
        conversationHistory: [],
        teachingProgress: {}
      },
      audioQueue: [],
      created: Date.now(),
      lastActivity: Date.now(),
      status: 'initializing',
      onAudioOutput: null,
      onTurnComplete: null,
      onInterrupted: null
    };

    const callbacks = {
      onopen: () => {
        sessionData.status = 'connected';
        console.log(`[SESSION] Session ${sessionId} connected to Gemini`);
      },
      onAudio: (audioData, mimeType) => {
        this.handleAudioOutput(sessionId, audioData, mimeType);
      },
      onToolCall: async (toolCall) => {
        await this.handleToolCall(sessionId, toolCall);
      },
      onTurnComplete: () => {
        this.handleTurnComplete(sessionId);
      },
      onInterrupted: () => {
        this.handleInterruption(sessionId);
      },
      onResumptionToken: (token) => {
        sessionData.resumptionToken = token;
        console.log(`[SESSION] Resumption token saved for session ${sessionId}`);
      },
      onerror: (error) => {
        sessionData.status = 'error';
        console.error(`[SESSION] Session ${sessionId} error:`, error);
      },
      onclose: () => {
        sessionData.status = 'closed';
        console.log(`[SESSION] Session ${sessionId} closed`);
      }
    };

    try {
      sessionData.geminiSession = await this.geminiClient.createSession(callbacks);
      sessionData.status = 'connected';
    } catch (error) {
      console.error(`[SESSION] Failed to create Gemini session for ${sessionId}:`, error);
      throw error;
    }

    this.sessions.set(sessionId, sessionData);
    return sessionData;
  }

  async handleToolCall(sessionId, toolCall) {
    console.log('\n🔧 [SESSION] === TOOL CALL RECEIVED ===');
    console.log('[SESSION] Tool name:', toolCall.name);
    console.log('[SESSION] Tool parameters:', JSON.stringify(toolCall.parameters, null, 2));

    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error('[SESSION] Session not found for tool call');
      return;
    }

    if (toolCall.name === 'search_textbook' && this.vectorStore) {
      try {
        // Handle missing or empty query
        const query = toolCall.parameters?.query || 'chapter 1';
        const chapter = toolCall.parameters?.chapter;
        const limit = toolCall.parameters?.limit || 5;

        console.log('[SESSION] Searching textbook with query:', query);
        if (chapter) {
          console.log('[SESSION] Filtering by chapter:', chapter);
        }

        const results = await this.vectorStore.search(
          query,
          {
            chapter: chapter,
            limit: limit
          }
        );

        console.log('[SESSION] Search returned', results.length, 'results');

        const response = {
          results: results.map(r => ({
            content: r.text,
            chapter: r.metadata?.chapterNumber,
            section: r.metadata?.sectionTitle,
            topic: r.metadata?.topic,
            score: r.score
          }))
        };

        console.log('[SESSION] Sending tool response back to Gemini');
        await this.geminiClient.sendToolResponse(
          session.geminiSession,
          toolCall.id,
          response,
          toolCall.name
        );

        console.log('[SESSION] ✅ Tool response sent successfully');
        console.log('[SESSION] === TOOL CALL PROCESSED ===\n');
      } catch (error) {
        console.error('[SESSION] ❌ Error handling tool call:', error);
        // Send empty response to avoid hanging
        await this.geminiClient.sendToolResponse(
          session.geminiSession,
          toolCall.id,
          { results: [], error: 'Search failed' },
          toolCall.name
        );
      }
    } else {
      console.warn('[SESSION] Unknown tool or vector store not available');
    }
  }

  handleAudioOutput(sessionId, audioData, mimeType) {
    console.log('[SESSION-AUDIO] handleAudioOutput called:');
    console.log('[SESSION-AUDIO] - Session ID:', sessionId);
    console.log('[SESSION-AUDIO] - Audio data length:', audioData?.length || 0);
    console.log('[SESSION-AUDIO] - MIME type:', mimeType);

    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error('[SESSION-AUDIO] ❌ Session not found:', sessionId);
      return;
    }

    session.audioQueue.push({
      data: audioData,
      mimeType: mimeType || 'audio/pcm;rate=24000',
      timestamp: Date.now()
    });
    console.log('[SESSION-AUDIO] Added to audio queue, queue length:', session.audioQueue.length);

    if (session.onAudioOutput) {
      console.log('[SESSION-AUDIO] Calling onAudioOutput callback for device:', session.deviceId);
      session.onAudioOutput(audioData, mimeType);
    } else {
      console.warn('[SESSION-AUDIO] ⚠️ No onAudioOutput callback registered for session:', sessionId);
    }
  }

  handleTurnComplete(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastActivity = Date.now();

    if (session.onTurnComplete) {
      session.onTurnComplete();
    }
  }

  handleInterruption(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.audioQueue = [];

    if (session.onInterrupted) {
      session.onInterrupted();
    }
  }

  async sendAudioInput(sessionId, audioData) {
    console.log('\n📡 [SESSION] === AUDIO INPUT RECEIVED IN SESSION MANAGER ===');
    console.log('[SESSION] - Session ID:', sessionId);
    console.log('[SESSION] - Audio data type:', typeof audioData);
    console.log('[SESSION] - Audio data length:', audioData?.length || 0);
    console.log('[SESSION] - First 30 chars:', audioData?.substring(0, 30));

    const session = this.sessions.get(sessionId);
    console.log('[SESSION] Session lookup:', {
      found: !!session,
      hasGeminiSession: !!session?.geminiSession,
      status: session?.status
    });

    if (!session || !session.geminiSession) {
      console.error('[SESSION] ❌ Session not found or not connected');
      console.error('[SESSION] Available sessions:', Array.from(this.sessions.keys()));
      throw new Error('Session not found or not connected');
    }

    session.lastActivity = Date.now();

    console.log('[SESSION] 🚀 Forwarding audio to Gemini client');
    console.log('[SESSION] - Session ID:', sessionId);
    console.log('[SESSION] - Gemini Session ID:', session.geminiSession);

    await this.geminiClient.sendAudio(
      session.geminiSession,
      audioData,
      'audio/pcm;rate=16000'
    );

    console.log('[SESSION] ✅ Audio forwarded to Gemini client');
    console.log('[SESSION] === AUDIO INPUT PROCESSED ===\n');
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session;
  }

  findSessionByDevice(deviceId) {
    for (const [sessionId, session] of this.sessions) {
      if (session.deviceId === deviceId) {
        return session;
      }
    }
    return null;
  }

  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.geminiSession) {
        this.geminiClient.closeSession(session.geminiSession);
      }
      this.sessions.delete(sessionId);
      console.log(`[SESSION] Session ${sessionId} closed and removed`);
    }
  }

  cleanupSessions() {
    const now = Date.now();
    const timeout = this.sessionTimeout;

    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > timeout) {
        console.log(`[SESSION] Cleaning up inactive session ${sessionId}`);
        this.closeSession(sessionId);
      }
    }
  }

  getSessionStats() {
    return {
      activeSessions: this.sessions.size,
      maxSessions: this.maxSessions,
      sessions: Array.from(this.sessions.values()).map(s => ({
        sessionId: s.sessionId,
        deviceId: s.deviceId,
        status: s.status,
        created: s.created,
        lastActivity: s.lastActivity,
        hasResumptionToken: !!s.resumptionToken
      }))
    };
  }

  cleanup() {
    for (const [sessionId, session] of this.sessions) {
      this.closeSession(sessionId);
    }
  }
}