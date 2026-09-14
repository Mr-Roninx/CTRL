import crypto from 'node:crypto';
import {
  insertAgentMemory,
  getMemories,
  getEpisodicMemories,
  getSemanticMemories,
  getWorkingMemoryForRun,
} from '../db/database.js';
import { AgentMemoryItem, MemoryType } from './types.js';
import { TemporalMemoryFirewall } from './temporal_firewall.js';
import { EmbeddingStore } from './memory/embedding_store.js';

export class AgentMemoryStore {
  private static MAX_WORKING_MEMORY_ITEMS = 50;

  /**
   * Appends an item to working memory for an active mission.
   */
  public static addWorkingMemory(params: {
    runId: string;
    opportunityId?: string;
    summary: string;
    provenance: string;
    semanticKey?: string;
    semanticValue?: string;
  }): AgentMemoryItem {
    const memoryId = `mem_w_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const item: AgentMemoryItem = {
      id: memoryId,
      memory_type: 'working',
      run_id: params.runId,
      opportunity_id: params.opportunityId || null,
      failure_type: null,
      context_summary: params.summary,
      action_taken: null,
      predicted_outcome: null,
      actual_outcome: null,
      prediction_error: null,
      semantic_key: params.semanticKey || null,
      semantic_value: params.semanticValue || null,
      confidence: 1.0,
      provenance: params.provenance,
      created_at: new Date().toISOString(),
    };

    insertAgentMemory(item);
    return item;
  }

  /**
   * Retrieves working memory for a run.
   */
  public static getWorkingMemory(runId: string): AgentMemoryItem[] {
    const memories = getWorkingMemoryForRun(runId);
    if (memories.length > this.MAX_WORKING_MEMORY_ITEMS) {
      return memories.slice(-this.MAX_WORKING_MEMORY_ITEMS);
    }
    return memories;
  }

  /**
   * Stores a completed mission episode into episodic memory.
   */
  public static recordEpisode(params: {
    runId: string;
    opportunityId: string;
    failureType: string;
    summary: string;
    actionTaken: string;
    predictedOutcome: string;
    actualOutcome: string;
    predictionError?: number;
    provenance: string;
  }): AgentMemoryItem {
    const memoryId = `mem_e_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const item: AgentMemoryItem = {
      id: memoryId,
      memory_type: 'episodic',
      run_id: params.runId,
      opportunity_id: params.opportunityId,
      failure_type: params.failureType,
      context_summary: params.summary,
      action_taken: params.actionTaken,
      predicted_outcome: params.predictedOutcome,
      actual_outcome: params.actualOutcome,
      prediction_error: params.predictionError !== undefined ? params.predictionError : null,
      semantic_key: `episode:${params.failureType}`,
      semantic_value: params.actionTaken,
      confidence: 0.9,
      provenance: params.provenance,
      created_at: new Date().toISOString(),
    };

    insertAgentMemory(item);
    EmbeddingStore.addDocument(item.id, `${item.failure_type || ''} ${item.context_summary} ${item.action_taken || ''}`, item);
    return item;
  }

  /**
   * Queries episodic memories under strict Temporal Memory Firewall constraints.
   */
  public static queryEpisodicMemories(params: {
    failureType?: string;
    cutoffTimestamp?: string;
    limit?: number;
  }): AgentMemoryItem[] {
    const cutoff = params.cutoffTimestamp || new Date().toISOString();
    const memories = getEpisodicMemories(params.failureType, cutoff);
    const filtered = TemporalMemoryFirewall.filterMemories(memories, cutoff);
    return filtered.slice(0, params.limit || 10);
  }

  /**
   * Stores a generalized pattern or domain rule into semantic memory.
   */
  public static recordSemanticMemory(params: {
    key: string;
    value: string;
    summary: string;
    confidence: number;
    provenance: string;
  }): AgentMemoryItem {
    const memoryId = `mem_s_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const item: AgentMemoryItem = {
      id: memoryId,
      memory_type: 'semantic',
      run_id: null,
      opportunity_id: null,
      failure_type: null,
      context_summary: params.summary,
      action_taken: null,
      predicted_outcome: null,
      actual_outcome: null,
      prediction_error: null,
      semantic_key: params.key,
      semantic_value: params.value,
      confidence: Math.max(0, Math.min(1, params.confidence)),
      provenance: params.provenance,
      created_at: new Date().toISOString(),
    };

    insertAgentMemory(item);
    EmbeddingStore.addDocument(item.id, `${item.semantic_key || ''} ${item.context_summary} ${item.semantic_value || ''}`, item);
    return item;
  }

  /**
   * Queries semantic memories under strict Temporal Memory Firewall constraints.
   */
  public static querySemanticMemories(params: {
    keyPrefix?: string;
    cutoffTimestamp?: string;
    limit?: number;
  }): AgentMemoryItem[] {
    const cutoff = params.cutoffTimestamp || new Date().toISOString();
    const memories = getSemanticMemories(params.keyPrefix, cutoff);
    const filtered = TemporalMemoryFirewall.filterMemories(memories, cutoff);
    return filtered.slice(0, params.limit || 20);
  }

  /**
   * Performs semantic similarity vector search across memories with Temporal Memory Firewall filtering.
   */
  public static searchSimilarMemories(params: {
    query: string;
    cutoffTimestamp?: string;
    topK?: number;
    minSimilarity?: number;
  }): Array<AgentMemoryItem & { similarity: number }> {
    const cutoff = params.cutoffTimestamp || new Date().toISOString();
    const matches = EmbeddingStore.searchSimilar<AgentMemoryItem>(
      params.query,
      (params.topK || 5) * 2,
      params.minSimilarity ?? 0.10
    );

    const memoryItems: Array<AgentMemoryItem & { similarity: number }> = [];
    for (const match of matches) {
      if (match.metadata) {
        memoryItems.push({
          ...match.metadata,
          similarity: match.similarity,
        });
      }
    }

    const filtered = TemporalMemoryFirewall.filterMemories(memoryItems, cutoff) as Array<
      AgentMemoryItem & { similarity: number }
    >;
    return filtered.slice(0, params.topK || 5);
  }
}
