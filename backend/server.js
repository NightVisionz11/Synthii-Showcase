import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import officeParser from 'officeparser';
import rateLimit from 'express-rate-limit';
import { supabase } from './config/supabase.js';
import PQueue from 'p-queue';

dotenv.config();

const app = express();
const PORT = 3001;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================
// OPTIMIZATION 1: Request Queue for OpenAI
// ============================================
const openaiQueue = new PQueue({ 
  concurrency: 1, // Only 1 OpenAI request at a time
  timeout: 28000, // 28 second timeout (under Render's 30s limit)
  throwOnTimeout: true
});

console.log('✅ OpenAI request queue initialized (concurrency: 1)');

// ============================================
// OPTIMIZATION 2: Response Cache
// ============================================
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function cacheGet(key) {
  const item = cache.get(key);
  if (!item) return null;
  
  if (Date.now() - item.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  
  return item.data;
}

function cacheSet(key, data) {
  // Limit cache size to prevent memory issues
  if (cache.size > 50) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
    console.log('♻️  Cache limit reached, removing oldest entry');
  }
  
  cache.set(key, { data, timestamp: Date.now() });
}

console.log('✅ Response cache initialized (50 items, 1hr TTL)');

// ============================================
// OPTIMIZATION 3: Memory Monitoring
// ============================================
function logMemory(context = '') {
  const usage = process.memoryUsage();
  const usedMB = Math.round(usage.rss / 1024 / 1024);
  const heapMB = Math.round(usage.heapUsed / 1024 / 1024);
  
  console.log(`[${context}] Memory: ${usedMB}MB total, ${heapMB}MB heap`);
  
  if (usedMB > 400) {
    console.warn(`⚠️  Memory high: ${usedMB}MB / 512MB`);
  }
  
  return usedMB;
}

// Monitor memory every 30 seconds
setInterval(() => {
  const usedMB = logMemory('Periodic Check');
  
  // Emergency garbage collection if memory is critical
  if (usedMB > 420 && global.gc) {
    console.warn('🚨 Emergency GC triggered');
    global.gc();
    
    setTimeout(() => {
      logMemory('After Emergency GC');
    }, 1000);
  }
}, 30000);

console.log('✅ Memory monitoring started');

// ============================================
// OPTIMIZATION 4: Optimized OpenAI Call Wrapper
// ============================================
async function callOpenAI(messages, maxTokens = 3000, cacheKey = null) {
  const startTime = Date.now();
  logMemory('Before OpenAI API');
  
  // Check cache first
  if (cacheKey) {
    const cached = cacheGet(cacheKey);
    if (cached) {
      console.log(`✅ Cache hit for ${cacheKey}`);
      return cached;
    }
  }
  
  // Add to queue to prevent concurrent requests
  const result = await openaiQueue.add(async () => {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages,
        max_tokens: maxTokens,
        temperature: 0.3,
      });
      
      const duration = Date.now() - startTime;
      console.log(`✅ OpenAI API completed in ${duration}ms`);
      
      return completion.choices[0].message.content;
    } catch (error) {
      console.error('❌ OpenAI API error:', error.message);
      throw error;
    }
  });
  
  logMemory('After OpenAI API');
  
  // Force garbage collection after heavy operation
  if (global.gc) {
    global.gc();
    console.log('♻️  GC triggered after API call');
  }
  
  // Cache the result
  if (cacheKey) {
    cacheSet(cacheKey, result);
  }
  
  return result;
}

// ============================================
// RATE LIMITERS (Your existing ones)
// ============================================
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

const quizLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: 'Quiz generation limit reached. Please try again in an hour.',
});

// ============================================
// FILE HANDLING (Your existing code)
// ============================================
const getFileType = (filename) => path.extname(filename).toLowerCase();

const extractTextFromTXT = async (filePath) => {
  return fs.readFileSync(filePath, 'utf-8');
};

export const extractTextFromFile = async (filePath) => {
  const ext = getFileType(filePath);

  switch (ext) {
    case '.pdf':
    case '.pptx':
    case '.docx':
    case '.doc':
      return await officeParser.parseOfficeAsync(filePath);
    case '.txt':
    case '.md':
      return await extractTextFromTXT(filePath);
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
};

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// HEALTH CHECK (Enhanced)
// ============================================
app.get('/health', (req, res) => {
  const usage = process.memoryUsage();
  res.json({ 
    status: 'Server is running!',
    memory: {
      used: Math.round(usage.rss / 1024 / 1024),
      heap: Math.round(usage.heapUsed / 1024 / 1024),
      limit: 512
    },
    queue: {
      size: openaiQueue.size,
      pending: openaiQueue.pending
    },
    cache: {
      size: cache.size,
      limit: 50
    }
  });
});

// ============================================
// SESSION ENDPOINTS (Your existing code - unchanged)
// ============================================
app.get('/api/sessions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const { data, error } = await supabase
      .from('study_sessions')
      .select('id, title, created_at, last_active, num_questions')
      .eq('user_id', userId)
      .order('last_active', { ascending: false });
    
    if (error) throw error;
    
    res.json({ sessions: data });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { userId, title, studyMaterial, numQuestions } = req.body;
    
    const { data, error } = await supabase
      .from('study_sessions')
      .insert([{
        user_id: userId,
        title,
        study_material: studyMaterial,
        original_study_material: studyMaterial,
        num_questions: numQuestions
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ session: data });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sessions/:userId/:sessionId', async (req, res) => {
  try {
    const { userId, sessionId } = req.params;
    
    const { data, error } = await supabase
      .from('study_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .single();
    
    if (error) throw error;
    
    const { data: history } = await supabase
      .from('question_history')
      .select('topic_set_id, question_text')
      .eq('session_id', sessionId);
    
    const { data: mastery } = await supabase
      .from('topic_mastery')
      .select('*')
      .eq('session_id', sessionId);
    
    res.json({ 
      session: data,
      questionHistory: history || [],
      topicMastery: mastery || []
    });
  } catch (error) {
    console.error('Error loading session:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const updates = req.body;
    
    const { data, error } = await supabase
      .from('study_sessions')
      .update({
        ...updates,
        last_active: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ session: data });
  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/sessions/:userId/:sessionId', async (req, res) => {
  try {
    const { userId, sessionId } = req.params;
    
    const { error } = await supabase
      .from('study_sessions')
      .delete()
      .eq('id', sessionId)
      .eq('user_id', userId);
    
    if (error) throw error;
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/question-history', async (req, res) => {
  try {
    const { sessionId, topicSetId, questions } = req.body;
    
    const records = questions.map(q => ({
      session_id: sessionId,
      topic_set_id: topicSetId,
      question_text: q.question
    }));
    
    const { error } = await supabase
      .from('question_history')
      .insert(records);
    
    if (error) throw error;
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving question history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/topic-mastery', async (req, res) => {
  try {
    const { sessionId, topicSetId, topicCorrectness } = req.body;
    
    const records = Object.entries(topicCorrectness).map(([topicId, stats]) => ({
      session_id: sessionId,
      topic_set_id: topicSetId,
      topic_id: topicId,
      correct: stats.correct,
      total: stats.total
    }));
    
    for (const record of records) {
      const { data: existing } = await supabase
        .from('topic_mastery')
        .select('*')
        .eq('session_id', sessionId)
        .eq('topic_set_id', topicSetId)
        .eq('topic_id', record.topic_id)
        .single();
      
      if (existing) {
        await supabase
          .from('topic_mastery')
          .update({
            correct: existing.correct + record.correct,
            total: existing.total + record.total,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('topic_mastery')
          .insert([record]);
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating mastery:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// FILE UPLOAD (Your existing code)
// ============================================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

app.post('/api/upload-file', upload.single('file'), async (req, res) => {
  console.log('=== FILE UPLOAD DEBUG ===');
  console.log('Request received');
  console.log('req.file:', req.file);
  
  if (!req.file) {
    console.log('ERROR: No file in request');
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  const originalName = req.file.originalname;
  console.log('File path:', filePath);
  console.log('Original filename:', req.file.originalname);
  console.log('File mimetype:', req.file.mimetype);
  console.log('File size:', req.file.size);

  try {
    console.log('Attempting to extract text...');
    const extractedText = await extractTextFromFile(filePath);
    console.log('Text extracted, length:', extractedText?.length);

    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('No text content found in file');
    }

    console.log('Success! Sending response...');
    res.json({ text: extractedText });
  } catch (err) {
    console.error('=== FILE PARSING ERROR ===');
    console.error('Error message:', err.message);
    console.error('Error stack:', err.stack);
    res.status(500).json({ error: err.message });
  } finally {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('Temp file deleted');
      }
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    }
  }
});

// ============================================
// EXTRACT ALL TOPICS (OPTIMIZED)
// ============================================
app.post('/api/extract-all-topics', quizLimiter, async (req, res) => {
  try {
    const { studyMaterial, userContext = '' } = req.body;

    if (!studyMaterial) {
      return res.status(400).json({ error: 'Study material is required' });
    }

    console.log('Extracting all topics from study material...');
    if (userContext) {
      console.log('User context provided:', userContext);
    }

    const truncatedMaterial = studyMaterial.slice(0, 15000);
    if (studyMaterial.length > 15000) {
      console.warn(`⚠️  Study material truncated from ${studyMaterial.length} to 15000 chars`);
    }

    const cacheKey = `topics-${Buffer.from(truncatedMaterial.slice(0, 100)).toString('base64')}`;

    // Build the user message with optional context
    let userMessage = truncatedMaterial;
    if (userContext.trim()) {
      userMessage = `IMPORTANT CONTEXT FROM USER:\n${userContext}\n\n---\n\nSTUDY MATERIAL:\n${truncatedMaterial}`;
    }

    const content = await callOpenAI(
      [
        {
          role: 'system',
          content: `Analyze the study material and identify ALL distinct topics/subjects covered, no matter how many there are.

${userContext.trim() ? 'Pay special attention to the user context provided - it contains important instructions about how to approach this material.' : ''}

Return ONLY valid JSON in this format:
{
  "topics": [
    {
      "id": "topic_1",
      "name": "Topic Name",
      "description": "Brief 1-sentence description",
      "weight": 3
    }
  ]
}

Guidelines:
- Extract EVERY distinct topic you can identify
- Make topics specific enough to be meaningful (not too broad)
- Topics should be distinct from each other (no overlap)
- Use clear, descriptive names
- Number topics sequentially (topic_1, topic_2, etc.)
- Aim for granularity - if material has 15+ topics, list them all
- CRITICAL: Assign a "weight" (1-5) based on how much content/depth the material has on that topic:
  * weight: 1 = Briefly mentioned, minimal content (1-2 potential questions)
  * weight: 2 = Light coverage, basic concepts (2-3 potential questions)
  * weight: 3 = Moderate coverage, standard depth (3-5 potential questions)
  * weight: 4 = Heavy coverage, detailed content (5-7 potential questions)
  * weight: 5 = Extensive coverage, major focus (7-10 potential questions)
- Be realistic about weights - not everything can be a 5`
        },
        {
          role: 'user',
          content: userMessage
        }
      ],
      2000,
      cacheKey
    );

    const jsonContent = content.replace(/```json?|```/g, '').trim();
    const result = JSON.parse(jsonContent);
    
    console.log(`Extracted ${result.topics.length} topics`);

    // Group topics into sets of 5-6
    const TOPICS_PER_SET = 5;
    const topicSets = [];
    
    for (let i = 0; i < result.topics.length; i += TOPICS_PER_SET) {
      const setTopics = result.topics.slice(i, i + TOPICS_PER_SET);
      topicSets.push({
        setId: `set_${Math.floor(i / TOPICS_PER_SET) + 1}`,
        setNumber: Math.floor(i / TOPICS_PER_SET) + 1,
        topics: setTopics,
        name: `Topics ${i + 1}-${Math.min(i + TOPICS_PER_SET, result.topics.length)}`
      });
    }

    console.log(`Created ${topicSets.length} topic sets`);

    res.json({
      allTopics: result.topics,
      topicSets: topicSets,
      totalTopics: result.topics.length,
      totalSets: topicSets.length
    });

  } catch (error) {
    console.error('Topic extraction error:', error);
    res.status(500).json({ error: 'Failed to extract topics: ' + error.message });
  }
});

// ============================================
// GENERATE QUIZ (OPTIMIZED)
// ============================================
app.post('/api/generate-quiz', quizLimiter, async (req, res) => {
  try {
    let { studyMaterial, numQuestions = 5, topicSet, previouslyAskedQuestions = [], userContext = ''  } = req.body;

    if (!studyMaterial) {
      return res.status(400).json({ error: 'Study material is required' });
    }

    if (!topicSet || !topicSet.topics || !topicSet.topics.length) {
      return res.status(400).json({ error: 'Topic set is required' });
    }

    console.log(`Generating quiz for topic set: ${topicSet.name}`);
    console.log(`Topics in set: ${topicSet.topics.map(t => t.name).join(', ')}`);
    console.log(`Previously asked questions to avoid: ${previouslyAskedQuestions.length}`);

    // Create cache key based on topic set
    const cacheKey = `quiz-${topicSet.setId}-${numQuestions}`;

    const topics = topicSet.topics;
    const topicObjects = topics.map((t, idx) => ({
      id: t.id || `topic_${idx + 1}`,
      name: t.name,
      description: t.description || '',
      weight: t.weight || 3
    }));

    // Calculate weighted distribution
    const totalWeight = topicObjects.reduce((sum, t) => sum + t.weight, 0);
    const questionsDistribution = topicObjects.map(topic => ({
      topic,
      targetQuestions: Math.max(1, Math.round((topic.weight / totalWeight) * numQuestions))
    }));

    // Adjust to match exact numQuestions
    let currentTotal = questionsDistribution.reduce((sum, d) => sum + d.targetQuestions, 0);
    let idx = 0;
    while (currentTotal < numQuestions) {
      questionsDistribution[idx % questionsDistribution.length].targetQuestions++;
      currentTotal++;
      idx++;
    }
    while (currentTotal > numQuestions) {
      const maxIdx = questionsDistribution.reduce((maxI, d, i, arr) => 
        d.targetQuestions > arr[maxI].targetQuestions ? i : maxI, 0);
      if (questionsDistribution[maxIdx].targetQuestions > 1) {
        questionsDistribution[maxIdx].targetQuestions--;
        currentTotal--;
      } else break;
    }

    console.log('Question distribution:', questionsDistribution.map(d => 
      `${d.topic.name}: ${d.targetQuestions} (weight: ${d.topic.weight})`
    ).join(', '));

    const allQuestions = [];

    // Build avoidance context
    const avoidanceContext = previouslyAskedQuestions.length > 0
      ? `\n\nCRITICAL - DO NOT ASK THESE QUESTIONS OR SIMILAR VARIATIONS:\n${previouslyAskedQuestions.slice(-50).map((q, idx) => `${idx + 1}. ${q}`).join('\n')}\n\nYour questions must be COMPLETELY DIFFERENT from these.`
      : '';

    // Extract only relevant content to reduce token usage
    const relevantContent = extractRelevantContent(studyMaterial, topicObjects);

    for (const distribution of questionsDistribution) {
      const topic = distribution.topic;
      const questionsForThisTopic = distribution.targetQuestions;

      if (questionsForThisTopic === 0) continue;

      const previousContext = allQuestions.length > 0
        ? `\n\nQuestions already generated in this quiz (create different ones):\n${allQuestions.map((q, idx) => `${idx + 1}. ${q.question}`).join('\n')}`
        : '';

      const content = await callOpenAI(
        [
          {
            role: 'system',
            content: `You are a quiz generator. Generate EXACTLY ${questionsForThisTopic} quiz questions about "${topic.name}".
${userContext ? `\nIMPORTANT USER INSTRUCTIONS: ${userContext}` : ''
}
${avoidanceContext}
${previousContext}




CRITICAL RULES:
- ALL questions must be specifically about: "${topic.name}"
- Set the "topic" field to EXACTLY: "${topic.name}"
- Ask one question that results in one answer, don't separate multiple questions in one with one answer choice.
- Questions should test understanding of key concepts
- Create UNIQUE questions - do not repeat or paraphrase previously asked questions
- Moreover, ensure that every angle of the study material related to "${topic.name}" is covered across the questions. If the material covers multiple subtopics or aspects of "${topic.name}", create questions that address each of those different facets to ensure comprehensive coverage.
- Vary question types: conceptual, application, comparison, analysis
- Avoid trivial or overly specific questions


Return ONLY this exact JSON structure with NO markdown formatting:
[
  {
    "question": "your question here",
    "options": ["option A", "option B", "option C", "option D"],
    "correct": "exact text of the correct option",
    "topic": "${topic.name}"
  }
]`
          },
          {
            role: 'user',
            content: `Study material:\n\n${relevantContent}\n\nGenerate ${questionsForThisTopic} UNIQUE questions specifically about "${topic.name}" - ${topic.description}

Topic weight: ${topic.weight}/5 (indicates depth of coverage in material)`
          }
        ],
        2500, // Reduced max tokens
        null // Don't cache individual topic questions
      );

      let jsonContent = content.replace(/```json?|```/g, '').trim();
      let questions = JSON.parse(jsonContent);

      questions = questions.map(q => ({
        ...q,
        topic: topic.name,
        topic_id: topic.id
      }));

      allQuestions.push(...questions);
    }

    const finalQuestions = allQuestions.slice(0, numQuestions);

    console.log(`Generated ${finalQuestions.length} questions across ${topicObjects.length} topics`);

    res.json({
      topics: topicObjects,
      questions: finalQuestions,
      topicSet: topicSet
    });
  } catch (error) {
    console.error('Quiz generation error:', error.message);
    
    if (error.name === 'TimeoutError') {
      return res.status(408).json({ 
        error: 'Quiz generation took too long. Try with shorter study material or fewer questions.',
        timeout: true
      });
    }
    
    res.status(500).json({ error: 'Failed to generate quiz: ' + error.message });
  }
});

// Helper function to extract relevant content
function extractRelevantContent(studyMaterial, topics) {
  const keywords = topics.flatMap(t => 
    t.name.toLowerCase().split(' ')
  );
  
  const sentences = studyMaterial.split(/[.!?]+/);
  const relevantSentences = sentences.filter(sentence => {
    const lower = sentence.toLowerCase();
    return keywords.some(keyword => lower.includes(keyword));
  });
  
  const relevant = relevantSentences.join('. ').slice(0, 2000);
  
  if (relevant.length < studyMaterial.length * 0.1) {
    return studyMaterial.slice(0, 2000);
  }
  
  return relevant;
}

// ============================================
// ANALYZE RESULTS (OPTIMIZED)
// ============================================
app.post('/api/analyze-results', async (req, res) => {
  const { questions, userAnswers, studyMaterial } = req.body;

  const incorrect = [];
  questions.forEach((q, i) => {
    if (q.options[userAnswers[i]] !== q.correct) {
      incorrect.push(q);
    }
  });

  if (incorrect.length === 0) {
    return res.json({
      analysis: "Perfect score! You've mastered these topics. Ready to move on to the next topic set or generate a follow-up quiz for extra practice.",
      topicsToReview: [],
      paginatedStudyGuide: [],
      incorrectCount: 0,
      totalCount: questions.length,
      scorePercent: 100
    });
  }

  const content = await callOpenAI(
    [
      {
        role: 'system',
        content: `Analyze the incorrect answers and return ONLY valid JSON with this structure:
{
  "summary": "Brief analysis of what topics need work",
  "topicsToReview": ["Topic 1", "Topic 2"],
  "studyGuide": [
    {
      "topic": "Topic Name",
      "content": ["Key point 1", "Key point 2", "Key point 3"]
    }
  ]
}
Focus on the concepts behind the questions the student got wrong.`
      },
      {
        role: 'user',
        content: `Study Material:\n${studyMaterial.slice(0, 2000)}\n\nIncorrect Questions:\n${JSON.stringify(incorrect, null, 2)}`
      }
    ],
    1500, // Reduced max tokens
    null // Don't cache analysis
  );

  const json = JSON.parse(
    content.replace(/```json?|```/g, '').trim()
  );

  res.json({
    analysis: json.summary,
    topicsToReview: json.topicsToReview,
    paginatedStudyGuide: json.studyGuide,
    incorrectCount: incorrect.length,
    totalCount: questions.length,
    scorePercent: ((questions.length - incorrect.length) / questions.length * 100).toFixed(1)
  });
});

// ============================================
// FOLLOW-UP QUIZ (OPTIMIZED)
// ============================================
app.post('/api/generate-followup-quiz', async (req, res) => {
  try {
    const { questions, userAnswers, studyMaterial, numQuestions = 5, userFeedback = '', topics = [] } = req.body;

    const weak = questions
      .filter((q, i) => q.options[userAnswers[i]] !== q.correct)
      .map(q => q.topic);

    const weakTopics = [...new Set(weak)];

    const topicObjects = topics.map((t, idx) => ({
      id: t.id || `topic_${idx + 1}`,
      name: t.name,
      description: t.description || ''
    }));

    const topicNames = topicObjects.map(t => t.name);

    // Generate all at once instead of in batches (more efficient)
    const weakTopicsContext = weakTopics.length > 0
      ? `\n\nPRIORITY: Focus more on these topics where the student struggled:\n${weakTopics.join(', ')}`
      : '';

    const topicInstruction = topicNames.length > 0
      ? `CRITICAL: The "topic" field must be EXACTLY one of these strings:\n${topicNames.map((name) => `- "${name}"`).join('\n')}`
      : 'Include a descriptive "topic" name for each question.';

    const content = await callOpenAI(
      [
        { 
          role: 'system', 
          content: `Generate EXACTLY ${numQuestions} UNIQUE follow-up questions.${weakTopicsContext}

${topicInstruction}

Guidelines:
- Focus primarily on weak areas but cover all topics in the set
- Create different questions than before
- Each question should test understanding in a new way

Return ONLY valid JSON:
[
  {
    "question": "question text",
    "options": ["option 1", "option 2", "option 3", "option 4"],
    "correct": "exact text of correct option",
    "topic": "ONE of the exact topic strings from the list above"
  }
]` 
        },
        {
          role: 'user',
          content: `Study material:\n${studyMaterial.slice(0, 2000)}\n\nUser feedback:\n${userFeedback || 'No specific feedback provided'}`
        }
      ],
      2500, // Reduced max tokens
      null // Don't cache follow-up quizzes
    );

    const jsonContent = content.replace(/```json?|```/g, '').trim();
    let followupQuestions = JSON.parse(jsonContent);
    
    followupQuestions = followupQuestions.map(q => {
      let topicObj = topicObjects.find(t => t.name === q.topic);
      if (!topicObj) {
        topicObj = topicObjects.find(t => t.name.toLowerCase().includes(q.topic.toLowerCase().trim()));
      }
      if (!topicObj && topicObjects.length > 0) {
        topicObj = topicObjects[0];
      }
      if (!topicObj) {
        topicObj = { id: 'unknown', name: q.topic || 'General' };
      }

      return {
        ...q,
        topic: topicObj.name,
        topic_id: topicObj.id
      };
    });

    const finalQuestions = followupQuestions.slice(0, numQuestions);

    res.json({ questions: finalQuestions });

  } catch (error) {
    console.error('Follow-up quiz generation error:', error);
    res.status(500).json({ error: 'Failed to generate follow-up quiz' });
  }
});

// ============================================
// EXPLAIN QUESTION (OPTIMIZED)
// ============================================
app.post('/api/explain-question', async (req, res) => {
  try {
    const { question, options, correctAnswer, userAnswer, isCorrect, studyMaterial } = req.body;

    const content = await callOpenAI(
      [
        {
          role: 'system',
          content: `You are a helpful tutor providing explanations for quiz questions. 
Provide a high level explanation of the answer and the related content.
Explain this to someone who is learning the subject, not to
a scientist who is familiar with all the jargon. 3 or 4 sentences max.`
        },
        {
          role: 'user',
          content: `Question: ${question}

Options:
${options.map((opt, idx) => `${String.fromCharCode(65 + idx)}) ${opt}`).join('\n')}

Correct Answer: ${correctAnswer}
Student's Answer: ${userAnswer}
Student was ${isCorrect ? 'correct' : 'incorrect'}

Study Material Context:
${studyMaterial.slice(0, 1000)}

Please provide a detailed explanation.`
        }
      ],
      500, // Small max tokens for explanations
      null // Don't cache explanations
    );

    const explanation = content.trim();

    res.json({ explanation });

  } catch (error) {
    console.error('Explanation generation error:', error);
    res.status(500).json({ error: 'Failed to generate explanation' });
  }
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log('='.repeat(50));
  console.log('Optimizations enabled:');
  console.log('  ✅ Request queue (concurrency: 1)');
  console.log('  ✅ Response caching (50 items, 1hr TTL)');
  console.log('  ✅ Memory monitoring (every 30s)');
  console.log('  ✅ Garbage collection (after API calls)');
  console.log('  ✅ Token optimization (reduced limits)');
  console.log('  ✅ Content extraction (relevant only)');
  console.log('='.repeat(50));
  console.log('Memory limit: 512 MB');
  console.log('Node max heap:', global.gc ? '450 MB' : '512 MB (no GC)');
  console.log('='.repeat(50));
  
  if (!global.gc) {
    console.warn('⚠️  WARNING: Garbage collection not enabled!');
    console.warn('   Run with: node --expose-gc --max-old-space-size=450 server.js');
  }
  
  logMemory('Server Start');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  logMemory('Uncaught Exception');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  logMemory('Unhandled Rejection');
});