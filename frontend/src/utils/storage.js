import { supabase } from './supabase';

/**
 * Storage adapter for managing quiz sessions, progress, and mastery data
 * Uses Supabase as the backend database with proper authentication
 */
class StorageAdapter {
  constructor() {
    this.currentSessionId = null;
  }

  /**
   * Get current authenticated user ID
   */
  async getUserId() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    return user.id;
  }

  /**
   * Get all sessions for the current user
   */
  async getSessions() {
    try {
      const userId = await this.getUserId();
      
      const { data, error } = await supabase
        .from('sessions')
        .select('id, title, created_at, last_active, num_questions, current_screen')
        .eq('user_id', userId)
        .order('last_active', { ascending: false });

      if (error) throw error;
      
      return data || [];
    } catch (error) {
      console.error('Error fetching sessions:', error);
      return [];
    }
  }

  /**
   * Create a new session
   */
  async createSession(title, studyMaterial, numQuestions = 5, userContext = '') {
  try {
    const userId = await this.getUserId();
    
    const { data, error } = await supabase
      .from('sessions')
      .insert({
        user_id: userId,
        title,
        study_material: studyMaterial,
        original_study_material: studyMaterial,
        num_questions: numQuestions,
        user_context: userContext, // ← Add this field
        current_screen: 'topic-selection',
        last_active: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    
    this.currentSessionId = data.id;
    return data;
  } catch (error) {
    console.error('Error creating session:', error);
    return null;
  }
}

  /**
   * Load a session with all related data
   */
  /**
 * Load a session with all related data
 */
/**
 * Load a session with all related data (OPTIMIZED - parallel queries)
 */
async loadSession(sessionId) {
  try {
    const userId = await this.getUserId();
    
    console.log('Loading session:', sessionId, 'for user:', userId);
    console.time('DB queries');
    
    // Set this FIRST before any other operations
    this.currentSessionId = sessionId;

    // Run all queries in PARALLEL instead of sequential
    const [sessionResult, historyResult, masteryResult, updateResult] = await Promise.all([
      // Get session data
      supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .single(),
      
      // Get question history
      supabase
        .from('question_history')
        .select('topic_set_id, question_text')
        .eq('session_id', sessionId),
      
      // Get topic mastery
      supabase
        .from('topic_mastery')
        .select('topic_set_id, topic_id, correct, total')
        .eq('session_id', sessionId),
      
      // Update last_active (fire and forget)
      supabase
        .from('sessions')
        .update({ last_active: new Date().toISOString() })
        .eq('id', sessionId)
    ]);

    console.timeEnd('DB queries');

    // Handle session result
    if (sessionResult.error) {
      console.error('Session query error:', sessionResult.error);
      throw sessionResult.error;
    }
    
    if (!sessionResult.data) {
      throw new Error('Session not found');
    }
    
    const session = sessionResult.data;
    console.log('Session loaded successfully');

    // Group questions by topic_set_id
    const questionHistory = {};
    historyResult.data?.forEach(item => {
      if (!questionHistory[item.topic_set_id]) {
        questionHistory[item.topic_set_id] = [];
      }
      questionHistory[item.topic_set_id].push(item.question_text);
    });

    // Group mastery by topic_set_id and topic_id
    const topicMastery = {};
    masteryResult.data?.forEach(item => {
      if (!topicMastery[item.topic_set_id]) {
        topicMastery[item.topic_set_id] = {};
      }
      topicMastery[item.topic_set_id][item.topic_id] = {
        correct: item.correct,
        total: item.total
      };
    });

    console.log('Loaded question history:', Object.keys(questionHistory).length, 'sets');
    console.log('Loaded topic mastery:', Object.keys(topicMastery).length, 'sets');

    return {
      session,
      questionHistory,
      topicMastery
    };
  } catch (error) {
    console.error('Error loading session:', error);
    console.error('Error stack:', error.stack);
    return null;
  }
}
  /**
   * Save current progress (auto-save)
   */
  async saveProgress(stateData) {
    try {
      if (!this.currentSessionId) {
        console.warn('No active session to save progress to');
        return false;
      }

      const { error } = await supabase
        .from('sessions')
        .update({
          current_screen: stateData.current_screen,
          current_topic_set_index: stateData.current_topic_set_index,
          topic_set_progress: stateData.topic_set_progress,
          num_questions: stateData.num_questions,
          study_material: stateData.study_material,
          original_study_material: stateData.original_study_material,
          all_topics: stateData.all_topics,
          topic_sets: stateData.topic_sets,
          current_questions: stateData.current_questions,
          current_question_index: stateData.current_question_index,
          current_answers: stateData.current_answers,
          selected_answer: stateData.selected_answer,
          score: stateData.score,
          topics: stateData.topics,
          question_explanations: stateData.question_explanations,
          analysis: stateData.analysis,
          paginated_study_guide: stateData.paginated_study_guide,
          topics_to_review: stateData.topics_to_review,
          last_active: new Date().toISOString()
        })
        .eq('id', this.currentSessionId);

      if (error) throw error;
      
      return true;
    } catch (error) {
      console.error('Error saving progress:', error);
      return false;
    }
  }

  /**
   * Save question history for a topic set
   */
  async saveQuestionHistory(topicSetId, questions) {
  try {
    if (!this.currentSessionId) {
      console.error('❌ No active session to save question history to');
      return false;
    }

    console.log('=== SAVING QUESTION HISTORY ===');
    console.log('Session ID:', this.currentSessionId);
    console.log('Topic Set ID:', topicSetId);
    console.log('Questions to save:', questions);

    const records = questions.map(q => ({
      session_id: this.currentSessionId,
      topic_set_id: topicSetId,
      question_text: q.question
    }));

    console.log('Records to insert:', records);

    const { data, error } = await supabase
      .from('question_history')
      .upsert(records, { 
        onConflict: 'session_id,topic_set_id,question_text',
        ignoreDuplicates: true 
      })
      .select();

    if (error) {
      console.error('❌ Insert error:', error);
      throw error;
    }
    
    console.log('✅ Question history saved successfully:', data);
    return true;
  } catch (error) {
    console.error('❌ Error saving question history:', error);
    return false;
  }
}

  /**
   * Update topic mastery (correct/total counts)
   */
  /**
 * Update topic mastery (INCREMENTAL - adds to existing counts)
 */
async updateTopicMastery(topicSetId, topicCorrectness) {
  try {
    if (!this.currentSessionId) {
      console.warn('No active session to update mastery for');
      return false;
    }

    console.log('=== UPDATING TOPIC MASTERY ===');
    console.log('Session ID:', this.currentSessionId);
    console.log('Topic Set ID:', topicSetId);
    console.log('Topic Correctness (incremental):', topicCorrectness);

    // For each topic, fetch existing data and add to it
    for (const [topicId, newData] of Object.entries(topicCorrectness)) {
      // First, get existing mastery for this topic
      const { data: existing, error: fetchError } = await supabase
        .from('topic_mastery')
        .select('correct, total')
        .eq('session_id', this.currentSessionId)
        .eq('topic_set_id', topicSetId)
        .eq('topic_id', topicId)
        .maybeSingle();

      if (fetchError) {
        console.error('Error fetching existing mastery:', fetchError);
        throw fetchError;
      }

      // Calculate new totals (add to existing or start fresh)
      const updatedCorrect = (existing?.correct || 0) + newData.correct;
      const updatedTotal = (existing?.total || 0) + newData.total;

      console.log(`Topic ${topicId}: existing(${existing?.correct || 0}/${existing?.total || 0}) + new(${newData.correct}/${newData.total}) = total(${updatedCorrect}/${updatedTotal})`);

      // Upsert with new totals
      const { error } = await supabase
        .from('topic_mastery')
        .upsert(
          {
            session_id: this.currentSessionId,
            topic_set_id: topicSetId,
            topic_id: topicId,
            correct: updatedCorrect,
            total: updatedTotal,
            updated_at: new Date().toISOString()
          },
          {
            onConflict: 'session_id,topic_set_id,topic_id'
          }
        );

      if (error) {
        console.error('Upsert error:', error);
        throw error;
      }
    }

    console.log('=== MASTERY UPDATE COMPLETE ===');
    return true;
  } catch (error) {
    console.error('Error updating topic mastery:', error);
    return false;
  }
}

/**
 * Get topic mastery for a specific topic set
 */
async getTopicMastery(topicSetId) {
  try {
    if (!this.currentSessionId) {
      console.warn('No active session to get mastery for');
      return {};
    }

    const { data, error } = await supabase
      .from('topic_mastery')
      .select('topic_id, correct, total')
      .eq('session_id', this.currentSessionId)
      .eq('topic_set_id', topicSetId);

    if (error) throw error;

    // Transform to the format expected by frontend
    const mastery = {};
    data?.forEach(item => {
      mastery[item.topic_id] = {
        correct: item.correct,
        total: item.total
      };
    });

    return mastery;
  } catch (error) {
    console.error('Error getting topic mastery:', error);
    return {};
  }
}
  /**
   * Delete a session and all related data
   */
  async deleteSession(sessionId) {
    try {
      const userId = await this.getUserId();
      
      const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('id', sessionId)
        .eq('user_id', userId);

      if (error) throw error;
      
      if (this.currentSessionId === sessionId) {
        this.currentSessionId = null;
      }
      
      return true;
    } catch (error) {
      console.error('Error deleting session:', error);
      return false;
    }
  }

  /**
   * Clear current progress (reset to welcome screen)
   */
  async clearProgress() {
    this.currentSessionId = null;
    return true;
  }
}

// Export singleton instance
export const storage = new StorageAdapter();