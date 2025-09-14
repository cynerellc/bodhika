export class VectorStore {
  constructor() {
    this.chunks = [];
    this.embeddings = [];
    this.metadata = [];
    this.indexBuilt = false;
  }

  async loadFromJSON(data) {
    console.log('[VECTOR] Loading vector store from JSON');

    // Support both formats: web app format (embeddings) and direct chunks format
    if (!data || (!data.chunks && !data.embeddings)) {
      throw new Error('Invalid textbook data format - expected "chunks" or "embeddings" array');
    }

    // Handle web app format (with embeddings array)
    if (data.embeddings) {
      console.log('[VECTOR] Detected web app format with embeddings');
      this.chunks = data.embeddings.map(embedding => ({
        text: embedding.content || embedding.text,  // Handle both 'content' and 'text' properties
        metadata: embedding.metadata || {},
        embedding: embedding.embedding || []
      }));
    }
    // Handle direct chunks format (legacy or simplified)
    else if (data.chunks) {
      console.log('[VECTOR] Detected chunks format');
      this.chunks = data.chunks.map(chunk => ({
        text: chunk.text || chunk.content,  // Handle both 'text' and 'content' properties
        metadata: chunk.metadata || {},
        embedding: chunk.embedding || []
      }));
    }

    this.embeddings = this.chunks.map(c => c.embedding);
    this.metadata = this.chunks.map(c => c.metadata);

    this.indexBuilt = true;

    console.log(`[VECTOR] Loaded ${this.chunks.length} chunks`);
    console.log(`[VECTOR] Chapters: ${[...new Set(this.metadata.map(m => m.chapterNumber))].length}`);

    return this;
  }

  async search(query, options = {}) {
    if (!this.indexBuilt) {
      console.warn('[VECTOR] No index built, returning empty results');
      return [];
    }

    const { chapter, limit = 5 } = options;

    console.log(`[VECTOR] Searching for: "${query}"`);
    if (chapter) {
      console.log(`[VECTOR] Filtering by chapter: ${chapter}`);
    }

    let results = [];

    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];

      if (chapter && chunk.metadata.chapterNumber !== chapter) {
        continue;
      }

      const score = this.calculateRelevanceScore(query.toLowerCase(), chunk.text.toLowerCase());

      if (score > 0) {
        results.push({
          text: chunk.text,
          metadata: chunk.metadata,
          score: score
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    results = results.slice(0, limit);

    console.log(`[VECTOR] Found ${results.length} results`);

    return results;
  }

  calculateRelevanceScore(query, text) {
    const queryWords = query.split(/\s+/);
    let score = 0;

    for (const word of queryWords) {
      if (text.includes(word)) {
        score += 1;

        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          score += matches.length * 0.5;
        }
      }
    }

    if (text.includes(query)) {
      score += 5;
    }

    return score;
  }

  getChapterContent(chapterNumber) {
    return this.chunks.filter(chunk =>
      chunk.metadata.chapterNumber === chapterNumber
    );
  }

  getSectionContent(chapterNumber, sectionTitle) {
    return this.chunks.filter(chunk =>
      chunk.metadata.chapterNumber === chapterNumber &&
      chunk.metadata.sectionTitle === sectionTitle
    );
  }

  getStats() {
    return {
      totalChunks: this.chunks.length,
      chapters: [...new Set(this.metadata.map(m => m.chapterNumber))].length,
      indexed: this.indexBuilt
    };
  }
}