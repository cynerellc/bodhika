import { GoogleGenAI, Modality } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class GeminiLiveClient {
  constructor(vectorStore) {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.client = null;
    this.modelName = process.env.MODEL_NAME || 'gemini-2.0-flash-exp';
    this.voiceName = process.env.VOICE_NAME || 'Leda';
    this.sessions = new Map();
    this.vectorStore = vectorStore;
    this.systemPrompt = '';
    this.isInitialized = false;

    if (this.apiKey) {
      this.initialize();
    } else {
      console.warn('⚠️ [GEMINI] GEMINI_API_KEY not set. Gemini features will be disabled.');
    }
  }

  initialize() {
    if (!this.apiKey) {
      throw new Error('Cannot initialize Gemini client without API key');
    }

    this.client = new GoogleGenAI({
      apiKey: this.apiKey
    });
    this.isInitialized = true;
    this.loadSystemPrompt();
  }


  async loadSystemPrompt() {
    try {
      const promptPath =  path.join(__dirname, '..', '..', 'data', 'system-prompt-hardcode.md');
      this.systemPrompt = await fs.readFile(promptPath, 'utf-8');
      console.log('[GEMINI] System prompt loaded successfully from:', promptPath);
      console.log('[GEMINI] System prompt length:', this.systemPrompt.length, 'characters');
    } catch (error) {
      console.warn('[GEMINI] System prompt file not found, using default');
      this.systemPrompt = `You are Bodhika, an AI Science Teacher at Sacred Heart CMI Public School in Thevara, Ernakulam.
You are teaching Science to a 6th Grade class through live audio interaction.
Maintain a warm, encouraging, and patient teaching style appropriate for 6th-grade students.
Use very simple English as students are ESL learners.
Speak naturally and conversationally, as if you're in a real classroom.

When students ask questions:
1. First acknowledge their question positively
2. Provide a clear, simple explanation
3. Use real-world examples they can relate to
4. Check if they understood by asking follow-up questions

Remember you're interacting through audio, so:
- Speak clearly and not too fast
- Use voice modulation to keep students engaged
- Pause appropriately for emphasis
- Be encouraging and supportive`;
    }
  }

  createVectorSearchTool() {
    if (!this.vectorStore) return null;

    return {
      name: 'search_textbook',
      description: 'Search the 6th grade science textbook database for relevant content. Use this for any science questions or topics.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant textbook content'
          },
          chapter: {
            type: 'number',
            description: 'Optional: Specific chapter number to search within'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return'
          }
        },
        required: ['query']
      }
    };
  }

  async createSession(callbacks = {}) {
    if (!this.isInitialized) {
      throw new Error('Gemini client not initialized. Please set GEMINI_API_KEY.');
    }

    try {
      console.log('\n=== GEMINI SESSION CREATION START ===');
      console.log('[GEMINI] Creating live audio session');
      console.log('[GEMINI] Model:', this.modelName);
      console.log('[GEMINI] Voice:', this.voiceName);
      console.log('[GEMINI] API Key present:', !!process.env.GEMINI_API_KEY);
      console.log('[GEMINI] API Key length:', process.env.GEMINI_API_KEY?.length);

      const sessionCallbacks = {
        onopen: () => {
          console.log('[GEMINI-CALLBACK] ✅ Live session opened successfully');
          if (callbacks.onopen) {
            console.log('[GEMINI-CALLBACK] Calling user onopen callback');
            callbacks.onopen();
          }
        },
        onmessage: (message) => {
          console.log('[GEMINI-CALLBACK] 📨 Message received from Gemini');
          this.handleMessage(message, callbacks);
        },
        onerror: (error) => {
          console.error('[GEMINI-CALLBACK] ❌ Session error:', error);
          console.error('[GEMINI-CALLBACK] Error details:', JSON.stringify(error, null, 2));
          if (callbacks.onerror) callbacks.onerror(error);
        },
        onclose: (event) => {
          console.log('[GEMINI-CALLBACK] 🔒 Session closed');
          console.log('[GEMINI-CALLBACK] Close reason:', event.reason);
          console.log('[GEMINI-CALLBACK] Close code:', event.code);
          if (callbacks.onclose) callbacks.onclose(event);
        }
      };

      console.log('[GEMINI] Attempting to connect with config:');

      // Build tools configuration if vector store is available
      const tools = [];
      if (this.vectorStore) {
        const vectorTool = this.createVectorSearchTool();
        if (vectorTool) {
          tools.push({
            functionDeclarations: [vectorTool]
          });
          console.log('[GEMINI] Vector search tool configured');
          console.log('[GEMINI] Tool structure:', JSON.stringify(tools, null, 2));
        }
      }

      const connectConfig = {
        model: `models/${this.modelName}`,
        systemInstruction: this.systemPrompt,
        callbacks: sessionCallbacks,
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.voiceName
              }
            }
          },
          // Tools must be inside the config object according to documentation
          tools: tools.length > 0 ? tools : undefined
        }
      };

      if (tools.length > 0) {
        console.log('[GEMINI] Tools added to config.tools');
      }

      console.log('[GEMINI] Connect config summary:', {
        model: connectConfig.model,
        hasSystemInstruction: !!connectConfig.systemInstruction,
        systemInstructionLength: connectConfig.systemInstruction?.length,
        hasTools: !!connectConfig.config.tools,
        toolCount: connectConfig.config.tools?.length || 0,
        voice: connectConfig.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName
      });

      const session = await this.client.live.connect(connectConfig);
      console.log('[GEMINI] ✅ Session object created successfully');

      const sessionId = uuidv4();
      this.sessions.set(sessionId, {
        session,
        callbacks,
        isActive: true
      });

      console.log('[GEMINI] ✅ Live audio session created:', sessionId);
      console.log('[GEMINI] Session stored in map');
      console.log('=== GEMINI SESSION CREATION END ===\n');
      return sessionId;

    } catch (error) {
      console.error('[GEMINI] ❌ Failed to create live session');
      console.error('[GEMINI] Error name:', error.name);
      console.error('[GEMINI] Error message:', error.message);
      console.error('[GEMINI] Error stack:', error.stack);
      console.error('=== GEMINI SESSION CREATION FAILED ===\n');
      throw error;
    }
  }

  handleMessage(message, callbacks) {
    console.log('\n--- GEMINI MESSAGE RECEIVED ---');
    console.log('[GEMINI-MSG] Message keys:', Object.keys(message || {}));
    console.log('[GEMINI-MSG] Full message structure:', JSON.stringify(message, null, 2).substring(0, 500));

    if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
      const audioData = message.serverContent.modelTurn.parts[0].inlineData;
      console.log('[GEMINI-AUDIO] 🎵 Audio data received:');
      console.log('[GEMINI-AUDIO] - MIME type:', audioData.mimeType);
      console.log('[GEMINI-AUDIO] - Data length:', audioData.data?.length || 0);
      console.log('[GEMINI-AUDIO] - Has callback:', !!callbacks.onAudio);

      if (callbacks.onAudio) {
        console.log('[GEMINI-AUDIO] ➡️ Calling onAudio callback');
        callbacks.onAudio(audioData.data, audioData.mimeType);
      } else {
        console.warn('[GEMINI-AUDIO] ⚠️ No onAudio callback registered!');
      }
    }

    if (message.toolCall) {
      console.log('[GEMINI-TOOL] 🔧 Tool call received');
      console.log('[GEMINI-TOOL] Full message structure:', JSON.stringify(message.toolCall, null, 2));

      if (callbacks.onToolCall) {
        // Handle both possible formats from Gemini
        let toolCall;
        if (message.toolCall.functionCalls && message.toolCall.functionCalls.length > 0) {
          const fc = message.toolCall.functionCalls[0];
          toolCall = {
            id: fc.id,
            name: fc.name,
            parameters: fc.args
          };
        } else {
          // Fallback format
          toolCall = {
            id: message.toolCall.id || 'tool_' + Date.now(),
            name: message.toolCall.name,
            parameters: message.toolCall.parameters || message.toolCall.args
          };
        }

        console.log('[GEMINI-TOOL] Extracted tool call:', toolCall.name);
        console.log('[GEMINI-TOOL] Tool ID:', toolCall.id);
        console.log('[GEMINI-TOOL] Parameters:', JSON.stringify(toolCall.parameters, null, 2));
        callbacks.onToolCall(toolCall);
      }
    }

    if (message.serverContent?.turnComplete) {
      console.log('[GEMINI-TURN] ✔️ Turn complete');
      if (callbacks.onTurnComplete) {
        console.log('[GEMINI-TURN] Calling onTurnComplete callback');
        callbacks.onTurnComplete();
      }
    }
    console.log('--- GEMINI MESSAGE HANDLED ---\n');

    if (message.serverContent?.interrupted) {
      console.log('[GEMINI-INTERRUPT] Interrupted');
      if (callbacks.onInterrupted) {
        callbacks.onInterrupted();
      }
    }

    if (message.resumptionToken) {
      console.log('[GEMINI-TOKEN] Resumption token received');
      if (callbacks.onResumptionToken) {
        callbacks.onResumptionToken(message.resumptionToken);
      }
    }
  }

  async sendAudio(sessionId, audioData, mimeType = 'audio/pcm;rate=16000') {
    console.log('\n=== SENDING AUDIO TO GEMINI ===');
    console.log('[GEMINI-SEND] 🎤 Preparing to send audio');
    console.log('[GEMINI-SEND] - Session ID:', sessionId);
    console.log('[GEMINI-SEND] - MIME type:', mimeType);
    console.log('[GEMINI-SEND] - Data length:', audioData?.length || 0);
    console.log('[GEMINI-SEND] - Data type:', typeof audioData);
    console.log('[GEMINI-SEND] - First 50 chars:', audioData?.substring(0, 50));

    const sessionData = this.sessions.get(sessionId);
    console.log('[GEMINI-SEND] Session lookup result:', {
      found: !!sessionData,
      isActive: sessionData?.isActive,
      hasSession: !!sessionData?.session
    });

    if (!sessionData || !sessionData.isActive) {
      console.error('[GEMINI-SEND] ❌ Session not found or inactive');
      console.error('[GEMINI-SEND] Available sessions:', Array.from(this.sessions.keys()));
      throw new Error('Session not found or inactive');
    }

    try {
      const audioBlob = {
        mimeType: mimeType,
        data: audioData
      };

      console.log('[GEMINI-SEND] Calling sendRealtimeInput with media blob');
      console.log('[GEMINI-SEND] Media blob structure:', JSON.stringify(audioBlob, null, 2).substring(0, 200));

      await sessionData.session.sendRealtimeInput({
        media: audioBlob
      });

      console.log('[GEMINI-SEND] ✅ Audio sent successfully to Gemini');
      console.log('=== AUDIO SEND COMPLETE ===\n');
    } catch (error) {
      console.error('[GEMINI-SEND] ❌ Failed to send audio');
      console.error('[GEMINI-SEND] Error name:', error.name);
      console.error('[GEMINI-SEND] Error message:', error.message);
      console.error('[GEMINI-SEND] Error stack:', error.stack);
      console.error('=== AUDIO SEND FAILED ===\n');
      throw error;
    }
  }

  async sendToolResponse(sessionId, toolCallId, response, toolName = 'search_textbook') {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData) {
        throw new Error('Session not found');
      }

      console.log('[GEMINI] Sending tool response for call:', toolCallId);
      console.log('[GEMINI] Tool name:', toolName);
      console.log('[GEMINI] Response data:', JSON.stringify(response, null, 2));

      // Format response according to documentation
      // The SDK expects the response to be an object, not a string
      const functionResponse = {
        id: toolCallId,
        name: toolName,
        response: response  // Send as object, not JSON string
      };

      console.log('[GEMINI] Sending tool response:', JSON.stringify(functionResponse, null, 2));

      // Send just the function response object, not wrapped
      await sessionData.session.sendToolResponse({
        functionResponses: [functionResponse]
      });

      console.log('[GEMINI] ✅ Tool response sent successfully:', toolCallId);
    } catch (error) {
      console.error('[GEMINI] ❌ Failed to send tool response:', error);
      console.error('[GEMINI] Error details:', error.message);
      throw error;
    }
  }

  closeSession(sessionId) {
    const sessionData = this.sessions.get(sessionId);
    if (sessionData) {
      sessionData.isActive = false;
      if (sessionData.session && sessionData.session.close) {
        sessionData.session.close();
      }
      this.sessions.delete(sessionId);
      console.log('[GEMINI] Session closed:', sessionId);
    }
  }
}