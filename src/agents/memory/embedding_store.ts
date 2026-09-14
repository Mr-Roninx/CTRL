/**
 * EmbeddingStore — Vector Storage & Cosine Similarity Search Engine
 * Provides semantic similarity retrieval for agent memories.
 * Uses a deterministic 64-dimensional semantic projection with optional external API support.
 */

export interface VectorDocument<T = any> {
  id: string;
  text: string;
  vector: number[];
  metadata?: T;
  timestamp: number;
}

export interface SimilaritySearchResult<T = any> {
  id: string;
  text: string;
  similarity: number;
  metadata?: T;
}

export class EmbeddingStore {
  private static documents: Map<string, VectorDocument> = new Map();
  private static VECTOR_DIM = 64;

  /**
   * Deterministic local embedding generator using term frequency, n-grams, and Murmur-like projection.
   * Runs in microseconds with zero network dependency.
   */
  public static generateLocalEmbedding(text: string): number[] {
    const clean = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = clean.split(/\s+/).filter((t) => t.length > 1);
    const vector = new Array(this.VECTOR_DIM).fill(0);

    if (tokens.length === 0) {
      return vector;
    }

    // Unigrams and bigrams
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token) continue;
      const hash1 = this.hashString(token) % this.VECTOR_DIM;
      const idx1 = Math.abs(hash1);
      vector[idx1] = (vector[idx1] ?? 0) + 1.0;

      if (i < tokens.length - 1) {
        const nextToken = tokens[i + 1];
        if (nextToken) {
          const bigram = `${token}_${nextToken}`;
          const hash2 = this.hashString(bigram) % this.VECTOR_DIM;
          const idx2 = Math.abs(hash2);
          vector[idx2] = (vector[idx2] ?? 0) + 1.5;
        }
      }
    }

    // L2 Normalize
    let norm = 0;
    for (let i = 0; i < this.VECTOR_DIM; i++) {
      const v = vector[i] ?? 0;
      norm += v * v;
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < this.VECTOR_DIM; i++) {
        vector[i] = (vector[i] ?? 0) / norm;
      }
    }

    return vector;
  }

  private static hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return hash >>> 0;
  }

  /**
   * Compute cosine similarity between two unit vectors.
   */
  public static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dot += ai * bi;
    }
    return Math.max(0, Math.min(1, dot));
  }

  /**
   * Add or update a document in the vector store.
   */
  public static addDocument<T = any>(id: string, text: string, metadata?: T, customVector?: number[]): void {
    const vector = customVector && customVector.length === this.VECTOR_DIM
      ? customVector
      : this.generateLocalEmbedding(text);

    this.documents.set(id, {
      id,
      text,
      vector,
      metadata,
      timestamp: Date.now(),
    });
  }

  /**
   * Search for documents semantically similar to a query.
   */
  public static searchSimilar<T = any>(
    queryText: string,
    topK: number = 5,
    minSimilarity: number = 0.15
  ): SimilaritySearchResult<T>[] {
    const queryVector = this.generateLocalEmbedding(queryText);
    const results: SimilaritySearchResult<T>[] = [];

    for (const doc of this.documents.values()) {
      const similarity = this.cosineSimilarity(queryVector, doc.vector);
      if (similarity >= minSimilarity) {
        results.push({
          id: doc.id,
          text: doc.text,
          similarity: Number(similarity.toFixed(4)),
          metadata: doc.metadata,
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * Remove a document by ID.
   */
  public static removeDocument(id: string): boolean {
    return this.documents.delete(id);
  }

  /**
   * Total indexed documents count.
   */
  public static count(): number {
    return this.documents.size;
  }

  /**
   * Clear all documents from the store.
   */
  public static clear(): void {
    this.documents.clear();
  }
}
