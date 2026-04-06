import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, ArrowRight, Check, RotateCcw, BookOpen, Sparkles, Brain, ChevronLeft, ChevronRight, Trash2, LogOut } from 'lucide-react';
import { storage } from './utils/storage';
import Auth from './components/auth';
import { supabase } from './utils/supabase';
import SynthiiLogo from './components/SynthiiLogo';

// Add this BEFORE const QuizApp = () => {
const SurveyModal = ({ isOpen, onClose, userId }) => {
  if (!isOpen) return null;
  
  const handleMarkAsSubmitted = () => {
    // Permanently dismiss - user completed the survey
    localStorage.setItem(`survey_dismissed_${userId}`, 'true');
    onClose();
  };
  
  const handleMaybeLater = () => {
    // Just close - will show again after next quiz completion
    onClose();
  };
  
  const handleNeverShow = () => {
    // Permanently dismiss - user doesn't want to take it
    localStorage.setItem(`survey_dismissed_${userId}`, 'true');
    onClose();
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold mb-2">Help Us Improve! 🎓</h2>
              <p className="text-blue-100">
                You've mastered 3+ topic sets! Share your experience (takes 2 min)
              </p>
            </div>
            <button
              onClick={handleMaybeLater}
              className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition-all"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* Google Form iframe */}
        <div className="h-[500px] overflow-auto bg-white">
          <iframe
            src="https://docs.google.com/forms/d/e/1FAIpQLScWup91m6Z6vYkN5Hr_gcqR0Ql5945iazk44Ny0mv90QK09Fg/viewform?embedded=true" width="640" height="1665" frameborder="0" marginheight="0" marginwidth="0">Loading…
            width="100%"
            height="100%"
            frameBorder="0"
            marginHeight="0"
            marginWidth="0"
            title="User Feedback Survey"
          
            Loading survey...
          </iframe>
        </div>
        
        {/* Footer with clear action buttons */}
        <div className="p-4 bg-gray-50 flex flex-col gap-3">
          {/* Primary action - they submitted */}
          <button
            onClick={handleMarkAsSubmitted}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            I've Submitted the Survey
          </button>
          
          {/* Secondary actions */}
          <div className="flex gap-2 justify-center">
            <button
              onClick={handleMaybeLater}
              className="text-blue-600 hover:text-blue-700 font-medium text-sm px-3 py-2 rounded hover:bg-blue-50"
            >
              Maybe after next quiz
            </button>
            <button
              onClick={handleNeverShow}
              className="text-gray-500 hover:text-gray-700 font-medium text-sm px-3 py-2 rounded hover:bg-gray-100"
            >
              Never show this
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const QuizApp = () => {
  const [questions, setQuestions] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [userAnswers, setUserAnswers] = useState([]);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [screen, setScreen] = useState('welcome'); // welcome, input, topic-selection, quiz, results
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [studyMaterial, setStudyMaterial] = useState('');
  const [numQuestions, setNumQuestions] = useState(5);
  const [analysis, setAnalysis] = useState('');
  const [originalStudyMaterial, setOriginalStudyMaterial] = useState('');
  const [currentStudyTopic, setCurrentStudyTopic] = useState(0);
  const [paginatedStudyGuide, setPaginatedStudyGuide] = useState([]);
  const [topicsToReview, setTopicsToReview] = useState([]);
  const [userFeedback, setUserFeedback] = useState('');
  const [expandedQuestion, setExpandedQuestion] = useState(null);
  const [questionExplanations, setQuestionExplanations] = useState({});
  const [loadingExplanation, setLoadingExplanation] = useState(null);
  const [topics, setTopics] = useState([]);
  const [generatingFollowUp, setGeneratingFollowUp] = useState(false);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [expandedFile, setExpandedFile] = useState(null);
  const [editedTexts, setEditedTexts] = useState({});
  const [userContext, setUserContext] = useState('');
  const [showSurveyModal, setShowSurveyModal] = useState(false);
  const [surveyDismissed, setSurveyDismissed] = useState(false);
  const totalQuizzesTakenRef = useRef(0); // ← Changed from completed count

  const MAX_TOTAL_CHARS = 500_000;
  
  // Topic set management
  const [allTopics, setAllTopics] = useState([]);
  const [topicSets, setTopicSets] = useState([]);
  const [currentTopicSetIndex, setCurrentTopicSetIndex] = useState(0);
  const [topicSetProgress, setTopicSetProgress] = useState({});
  
  // Session management
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const sessionsLoadedRef = useRef(false);


  
  // Question history and mastery (loaded from DB per session)
  const [questionHistory, setQuestionHistory] = useState({});
  const [topicMastery, setTopicMastery] = useState({});

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';


  // Check auth on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);
  // Add this with your other useEffect hooks
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]); // Scroll to top whenever screen changes

  // Show loading
  // Load sessions on mount - only when user is authenticated

  
// After the auth useEffect, add this:
/*
useEffect(() => {
  const restoreSession = async () => {
    if (!user) return;
    
    // Check if we have progress to restore
    const sessions = await storage.getSessions();
    if (sessions && sessions.length > 0) {
      // Get the most recent session
      const lastSession = sessions[0]; // Already sorted by last_active desc
      
      // Only auto-restore if we're on welcome screen and not in a clean state
      // This prevents auto-loading when user explicitly went back to welcome
      if (screen === 'welcome' && !studyMaterial) {
        console.log('Restoring last session:', lastSession.id);
        await handleLoadSession(lastSession.id);
      }
    }
  };
  
  if (user && !authLoading) {
    restoreSession();
  }
}, [user, authLoading]); // Only run when auth state changes*/

useEffect(() => {
  const loadSessions = async () => {
    if (!user) {
      setSessions([]);
      return;
    }
    
    // Skip if already loaded
    if (sessionsLoadedRef.current) return;
    
    setLoadingSessions(true);
    try {
      const sessionList = await storage.getSessions();
      setSessions(sessionList || []);
      sessionsLoadedRef.current = true; // Mark as loaded
    } catch (error) {
      console.error('Error loading sessions:', error);
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  };
  
  if (user) {
    loadSessions();
  }
}, [user]);
  const saveCurrentState = useCallback(async () => {
  if (screen === 'results') return;
  if (screen === 'welcome' || (screen === 'input' && !studyMaterial.trim())) return;
  
  const stateToSave = {
    current_screen: screen,
    current_topic_set_index: currentTopicSetIndex,
    topic_set_progress: topicSetProgress,
    num_questions: numQuestions,
    study_material: studyMaterial || undefined,
    original_study_material: originalStudyMaterial || undefined,
    all_topics: allTopics.length > 0 ? allTopics : undefined,
    topic_sets: topicSets.length > 0 ? topicSets : undefined,
    ...(screen === 'quiz' || screen === 'results'
      ? {
          current_questions: questions,
          current_question_index: currentQuestion,
          current_answers: userAnswers,
          selected_answer: selectedAnswer,
          score: score,
          topics: topics,
          question_explanations: questionExplanations,
          analysis: analysis,
          paginated_study_guide: paginatedStudyGuide,
          topics_to_review: topicsToReview
        }
      : {})
  };

  await storage.saveProgress(stateToSave);
}, [
  // Remove dependencies that change frequently during quiz
  screen, currentTopicSetIndex, topicSetProgress, numQuestions,
  studyMaterial, originalStudyMaterial, allTopics, topicSets
  // Removed: questions, currentQuestion, userAnswers, selectedAnswer, etc.
]);


// Check if user should see survey
useEffect(() => {
  console.log('🔍 Survey useEffect running');
  
  if (!user) return;
  
  const dismissed = localStorage.getItem(`survey_dismissed_${user.id}`);
  if (dismissed) {
    console.log('❌ Survey dismissed');
    setSurveyDismissed(true);
    return;
  }
  
  // Count TOTAL quizzes taken (not just completed sets)
  const totalQuizzes = Object.values(topicSetProgress).reduce(
    (sum, progress) => sum + (progress.attempts || 0), 
    0
  );
  
  // Count completed sets with 70%+
  const completedSets = Object.values(topicSetProgress).filter(
    p => p.completed && p.bestScore >= 70
  ).length;
  
  console.log('📊 Total quizzes taken:', totalQuizzes);
  console.log('📊 Previous quiz count:', totalQuizzesTakenRef.current);
  console.log('📊 Completed sets:', completedSets);
  
  // First run - initialize
  if (totalQuizzesTakenRef.current === 0 && totalQuizzes > 0) {
    console.log('🔧 First run - initializing ref to:', totalQuizzes);
    totalQuizzesTakenRef.current = totalQuizzes;
    return;
  }
  
  // Check if they just took a quiz AND have 3+ completed sets
  if (totalQuizzes > totalQuizzesTakenRef.current && completedSets >= 3) {
    console.log('✅ SHOWING SURVEY!');
    totalQuizzesTakenRef.current = totalQuizzes;
    setTimeout(() => setShowSurveyModal(true), 2000);
  } else {
    console.log('❌ Not showing - either no new quiz or less than 3 completed sets');
  }
}, [topicSetProgress, user]);
// Separate effect for quiz state - only save on question change, not answer selection
useEffect(() => {
  if (screen !== 'quiz') return;
  
  const timer = setTimeout(() => {
    saveCurrentState();
  }, 5000);
  
  return () => clearTimeout(timer);
}, [currentQuestion, screen]); // Only when moving to next question
  useEffect(() => {
    const timer = setTimeout(() => {
      saveCurrentState();
    }, 10000);

    return () => clearTimeout(timer);
  }, [saveCurrentState]);

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600"></div>
    </div>;
  }

  // Show auth if not logged in
  if (!user) {
    return <Auth onAuthSuccess={(user) => setUser(user)} />;
  }
  // Auto-save current state
    
  

  // Helper functions for question history and mastery
  const getHistoryForTopicSet = (topicSetId) => {
    return questionHistory[topicSetId] || [];
  };

  const getMasteryForTopicSet = (topicSetId) => {
    return topicMastery[topicSetId] || {};
  };

  const handleLoadSession = async (sessionId) => {
  try {
    setLoading(true);
    const data = await storage.loadSession(sessionId);
    
    if (!data) {
      throw new Error('No data returned from loadSession');
    }

    const session = data.session || data;
    const loadedHistory = data.questionHistory || {};
    const loadedMastery = data.topicMastery || {};
    
    console.log('Loaded session data:', session);
    
    setStudyMaterial(session.study_material || '');
    setOriginalStudyMaterial(session.original_study_material || session.study_material || '');
    setNumQuestions(session.num_questions || 5);
    setAllTopics(session.all_topics || []);
    setTopicSets(session.topic_sets || []);
    setCurrentTopicSetIndex(session.current_topic_set_index || 0);
    setTopicSetProgress(session.topic_set_progress || {});
    
    setQuestionHistory(loadedHistory);
    setTopicMastery(loadedMastery);
    
    // ALWAYS go to topic-selection when loading a session
    // This avoids the race condition with results screen
    setScreen('topic-selection');
    
  } catch (error) {
    console.error('Error loading session:', error);
    alert('Failed to load session: ' + error.message);
  } finally {
    setLoading(false);
  }
};

  const handleSignOut = async () => {
  await supabase.auth.signOut();
  setUser(null);
  sessionsLoadedRef.current = false;
  totalQuizzesTakenRef.current = 0;
  // Just reset state, don't try to load sessions
  setQuestions([]);
  setCurrentQuestion(0);
  setUserAnswers([]);
  setSelectedAnswer('');
  setScore(0);
  setStudyMaterial('');
  setAnalysis('');
  setAllTopics([]);
  setTopicSets([]);
  setCurrentTopicSetIndex(0);
  setTopicSetProgress({});
  setSessionTitle('');
  setQuestionHistory({});
  setTopicMastery({});
  setSessions([]); // Clear sessions without fetching
  setScreen('welcome');
};

  const handleDeleteSession = async (sessionId, sessionTitle) => {
    if (!window.confirm(`Delete "${sessionTitle}"? This cannot be undone.`)) {
      return;
    }
    
    const success = await storage.deleteSession(sessionId);
    if (success) {
      setSessions(sessions.filter(s => s.id !== sessionId));
    } else {
      alert('Failed to delete session');
    }
  };


  const handleExtractTopics = async () => {
  if (!sessionTitle.trim()) {
    alert('Please enter a title for this study session');
    return;
  }
  const material = uploadedFiles.length > 0 ? getStudyMaterial() : studyMaterial;

  try {
    setLoading(true);
    
    const session = await storage.createSession(
      sessionTitle,
      material,
      numQuestions,
      userContext
    );
    
    if (!session) {
      throw new Error('Failed to create session');
    }

    setOriginalStudyMaterial(material);
    
    const response = await fetch(`${API_URL}/api/extract-all-topics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studyMaterial: material,
        userContext: userContext // ← Add this
      })
    });
    
    // ... rest unchanged
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to extract topics');
      }

      const data = await response.json();
      
      setAllTopics(data.allTopics);
      setTopicSets(data.topicSets);
      console.log('Topic sets with IDs:', data.topicSets);      
      // Initialize progress tracking
      const progress = {};
      data.topicSets.forEach(set => {
        progress[set.setId] = {
          completed: false,
          bestScore: 0,
          attempts: 0
        };
      });
      setTopicSetProgress(progress);
      
      setCurrentTopicSetIndex(0);
      setScreen('topic-selection');
      
      // Reset history and mastery for new session
      setQuestionHistory({});
      setTopicMastery({});
      
    } catch (err) {
      console.error('Topic extraction error:', err);
      alert(err.message || 'Failed to extract topics. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateQuizForSet = async (setIndex) => {
  try {
    setLoading(true);
    const topicSet = topicSets[setIndex];

    // Get previously asked questions for this topic set
    const previouslyAsked = getHistoryForTopicSet(topicSet.setId);
    console.log(`Generating quiz for ${topicSet.name}. Avoiding ${previouslyAsked.length} previously asked questions.`);

    const response = await fetch(`${API_URL}/api/generate-quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studyMaterial: originalStudyMaterial,
        numQuestions,
        topicSet,
        previouslyAskedQuestions: previouslyAsked,
        userContext: userContext || ''  // ✅ ADD THIS LINE
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to generate quiz');
    }

    const data = await response.json();
    const { topics, questions } = data;

    if (!topics || !questions || !Array.isArray(topics) || !Array.isArray(questions)) {
      throw new Error('Invalid quiz payload from server');
    }

    console.log('=== ABOUT TO SAVE QUESTION HISTORY ===');
    console.log('Current session ID:', storage.currentSessionId);
    console.log('Topic set ID:', topicSet.setId);
    console.log('Questions:', questions);

    // Save these questions to database
    const saveSuccess = await storage.saveQuestionHistory(topicSet.setId, questions);
    console.log('Question history save result:', saveSuccess);

    // Update local state
    setQuestionHistory(prev => ({
      ...prev,
      [topicSet.setId]: [...(prev[topicSet.setId] || []), ...questions.map(q => q.question)]
    }));

    setTopics(topics);
    setQuestions(questions);
    setCurrentQuestion(0);
    setUserAnswers([]);
    setSelectedAnswer('');
  
    
    setExpandedQuestion(null);
    setQuestionExplanations({});
    
    setCurrentTopicSetIndex(setIndex);
    setScreen('quiz');
    
  } catch (err) {
    console.error('Quiz generation error:', err);
    alert(err.message || 'Failed to generate quiz. Check console for details.');
  } finally {
    setLoading(false);
    
  }
};
// DELETE handleGeneralFileUpload entirely, replace with:
const handleGeneralFileUpload = async (event) => {
  const newFiles = Array.from(event.target.files);
  if (!newFiles.length) return;

  const existingNames = new Set(uploadedFiles.map((f) => f.name));
  const duplicates = newFiles.filter((f) => existingNames.has(f.name));
  if (duplicates.length) {
    alert(`Already uploaded: ${duplicates.map((f) => f.name).join(', ')}`);
    return;
  }

  setLoading(true);
  try {
    const results = await Promise.all(
      newFiles.map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`${API_URL}/api/upload-file`, {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Failed to process ${file.name}`);
        return { name: file.name, size: data.text.length, text: data.text };
      })
    );

    const incomingChars = results.reduce((sum, f) => sum + f.size, 0);
    const currentTotal = uploadedFiles.reduce((sum, f) => sum + f.size, 0);
    if (currentTotal + incomingChars > MAX_TOTAL_CHARS) {
      alert(`Upload would exceed the ${MAX_TOTAL_CHARS / 1000}KB limit.`);
      return;
    }

    setUploadedFiles((prev) => [...prev, ...results]);
  } catch (err) {
    console.error('Upload error:', err);
    alert('Error uploading file: ' + err.message);
  } finally {
    setLoading(false);
    event.target.value = '';
  }
};

const removeFile = (fileName) => {
  setUploadedFiles((prev) => prev.filter((f) => f.name !== fileName));
  setEditedTexts((prev) => { const next = { ...prev }; delete next[fileName]; return next; });
  if (expandedFile === fileName) setExpandedFile(null);
};

// Call this wherever you currently reference `studyMaterial` when sending to OpenAI:
const getStudyMaterial = () =>
  uploadedFiles
    .map((f) => `--- ${f.name} ---\n${editedTexts[f.name] ?? f.text}`)
    .join('\n\n');

  

  const handleGetExplanation = async (questionIndex) => {
    if (expandedQuestion === questionIndex) {
      setExpandedQuestion(null);
      return;
    }

    if (questionExplanations[questionIndex]) {
      setExpandedQuestion(questionIndex);
      return;
    }

    setLoadingExplanation(questionIndex);
    setExpandedQuestion(questionIndex);

    try {
      const q = questions[questionIndex];
      const userAnswerIdx = userAnswers[questionIndex];
      const userAnswer = q.options[userAnswerIdx];
      const isCorrect = userAnswer === q.correct;

      const response = await fetch(`${API_URL}/api/explain-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q.question,
          options: q.options,
          correctAnswer: q.correct,
          userAnswer: userAnswer,
          isCorrect: isCorrect,
          studyMaterial: originalStudyMaterial
        })
      });

      if (!response.ok) throw new Error('Failed to get explanation');

      const data = await response.json();
      
      setQuestionExplanations(prev => ({
        ...prev,
        [questionIndex]: data.explanation
      }));
    } catch (error) {
      console.error('Error getting explanation:', error);
      setQuestionExplanations(prev => ({
        ...prev,
        [questionIndex]: 'Unable to generate explanation at this time.'
      }));
    } finally {
      setLoadingExplanation(null);
    }
  };

  const handleNextQuestion = async () => {
  if (selectedAnswer === '') {
    alert('Please select an answer before continuing');
    return;
  }

  const newAnswers = [...userAnswers, parseInt(selectedAnswer)];
  setUserAnswers(newAnswers);

  if (currentQuestion < questions.length - 1) {
    setCurrentQuestion(currentQuestion + 1);
    setSelectedAnswer('');
  } else {
    // Calculate score immediately
    let correct = 0;
    newAnswers.forEach((answerIdx, i) => {
      const q = questions[i];
      if (!q) return;
      if (q.options?.[answerIdx] === q.correct) {
        correct++;
      }
    });

    setScore(correct);

    // Calculate topic correctness
    const topicCorrectness = {};
    newAnswers.forEach((answerIdx, i) => {
      const q = questions[i];
      if (!q) return;

      const isCorrect = q.options?.[answerIdx] === q.correct;
      
      if (!topicCorrectness[q.topic_id]) {
        topicCorrectness[q.topic_id] = { correct: 0, total: 0 };
      }
      
      topicCorrectness[q.topic_id].total++;
      if (isCorrect) {
        topicCorrectness[q.topic_id].correct++;
      }
    });

    // Update progress
    const currentSet = topicSets[currentTopicSetIndex];
    const scorePercent = (correct / questions.length) * 100;

    const updatedTopicSetProgress = {
      ...topicSetProgress,
      [currentSet.setId]: {
        completed: true,
        bestScore: Math.max(
          topicSetProgress[currentSet.setId]?.bestScore || 0,
          scorePercent
        ),
        attempts: (topicSetProgress[currentSet.setId]?.attempts || 0) + 1
      }
    };

    setTopicSetProgress(updatedTopicSetProgress);

    // 🚀 IMMEDIATELY GO TO RESULTS SCREEN (feels instant!)
    setScreen('results');
    
    // 🔄 Then do all the async operations in the background
    (async () => {
      try {
        console.log('=== SAVING MASTERY DATA (background) ===');
        console.log('Current session ID:', storage.currentSessionId);
        console.log('Topic set ID:', currentSet.setId);
        console.log('Topic correctness to save:', topicCorrectness);

        // Save to database in background
        const saveSuccess = await storage.updateTopicMastery(currentSet.setId, topicCorrectness);
        console.log('Mastery save result:', saveSuccess);

        // Fetch updated mastery from database
        const updatedMastery = await storage.getTopicMastery(currentSet.setId);
        
        // Update local mastery state
        setTopicMastery(prev => ({
          ...prev,
          [currentSet.setId]: updatedMastery
        }));

        console.log(`Updated mastery for ${currentSet.setId}:`, updatedMastery);
        
        // Analyze results (this also runs in background)
        await analyzeResultsAsync(newAnswers);
      } catch (error) {
        console.error('Error in background operations:', error);
      }
    })();
  }
};

// Separate async function for analysis
const analyzeResultsAsync = async (answers) => {
  const correct = answers.filter((answerIdx, i) => {
    const q = questions[i];
    return q?.options?.[answerIdx] === q?.correct;
  }).length;

   if (correct === answers.length) {
    setAnalysis("Perfect score! You've mastered these topics. Ready to move on to the next topic set or generate a follow-up quiz for extra practice.");
    setPaginatedStudyGuide([]);
    setTopicsToReview([]);
    return; // ← never hits the API
  }
  setLoading(true); // Show spinner in results screen
  
  try {
    const response = await fetch(`${API_URL}/api/analyze-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questions,
        userAnswers: answers,
        studyMaterial: originalStudyMaterial
      })
    });

    if (!response.ok) throw new Error('Failed to analyze results');

    const data = await response.json();

    setPaginatedStudyGuide(data.paginatedStudyGuide || []);
    setTopicsToReview(data.topicsToReview || []);
    setCurrentStudyTopic(0);
    setAnalysis(data.analysis || '');

  } catch (error) {
    console.error('Error analyzing results:', error);
    setAnalysis('Unable to generate analysis at this time.');
  } finally {
    setLoading(false);
  }
};
const handleGenerateFollowUp = async () => {
  setGeneratingFollowUp(true);
  try {
    const response = await fetch(`${API_URL}/api/generate-followup-quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questions: questions,
        userAnswers: userAnswers,
        studyMaterial: originalStudyMaterial,
        numQuestions: numQuestions,
        userFeedback: userFeedback,
        topics: topics,
        userContext: userContext || ''  // ✅ ADD THIS LINE
      })
    });
    
    if (!response.ok) throw new Error('Failed to generate follow-up quiz');
    
    const data = await response.json();
    
    // Save to database
    const currentSet = topicSets[currentTopicSetIndex];
    await storage.saveQuestionHistory(currentSet.setId, data.questions);
    
    // Update local state
    setQuestionHistory(prev => ({
      ...prev,
      [currentSet.setId]: [...(prev[currentSet.setId] || []), ...data.questions.map(q => q.question)]
    }));
    
    setQuestions(data.questions);
    setCurrentQuestion(0);
    setUserAnswers([]);
    setSelectedAnswer('');
    
    setExpandedQuestion(null);
    setQuestionExplanations({});
    
    setScreen('quiz');
    setUserFeedback('');
  } catch (error) {
    alert('Error generating follow-up quiz: ' + error.message);
  } finally {
    setGeneratingFollowUp(false);
  }
};
  
  const handleRestart = async () => {
  await storage.clearProgress();

  setQuestions([]);
  setCurrentQuestion(0);
  setUserAnswers([]);
  setSelectedAnswer('');
  setScore(0);
  setStudyMaterial('');
  setAnalysis('');
  setAllTopics([]);
  setTopicSets([]);
  setCurrentTopicSetIndex(0);
  setTopicSetProgress({});
  setSessionTitle('');
  setQuestionHistory({});
  setTopicMastery({});

  // Only reload sessions if user is authenticated
  if (user) {
    const sessionList = await storage.getSessions();
    setSessions(sessionList || []);
  } else {
    setSessions([]);
  }

  setScreen('welcome');
};



// Welcome Screen
if (screen === 'welcome') {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-3 md:p-6 overflow-y-auto">
      <div className="max-w-6xl mx-auto py-4 md:py-8">
        {/* Sign Out button in top right */}
        <div className="flex justify-end mb-4">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-800 bg-white px-4 py-2 rounded-lg shadow hover:shadow-md transition-all"
          >
            <LogOut size={18} />
            <span>Sign Out</span>
          </button>
        </div>

        <div className="text-center mb-12">
          <div className="mb-6">
            <SynthiiLogo size={96} />
          </div>
          <h1 className="text-3xl md:text-5xl font-bold text-gray-800 mb-4 mt-6 brand-font">
          Synthii
          </h1>
          
          <p className="text-lg md:text-xl text-gray-600">
           Master your study material one topic set at a time
          </p>
        </div>

        {loadingSessions ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-600 mt-4">Loading your sessions...</p>
          </div>
        ) : sessions.length > 0 ? (
          <>
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Study Sessions</h2>
              <div className="grid gap-4">
                {sessions.map(session => (
                  <div key={session.id} className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-gray-800 mb-2">{session.title}</h3>
                        <div className="text-sm text-gray-500 space-y-1">
                          <p>Created: {new Date(session.created_at).toLocaleDateString()}</p>
                          <p>Last active: {new Date(session.last_active).toLocaleDateString()}</p>
                          <p>{session.num_questions} questions per quiz</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleLoadSession(session.id)}
                          disabled={loading}
                          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg transition-colors"
                        >
                          {loading ? 'Loading...' : 'Continue'}
                        </button>
                        <button
                          onClick={() => handleDeleteSession(session.id, session.title)}
                          className="bg-red-100 hover:bg-red-200 text-red-600 px-4 py-2 rounded-lg transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-center">
              <div className="inline-block w-full max-w-md border-t border-gray-300 my-8"></div>
            </div>
          </>
        ) : null}

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">
            {sessions.length > 0 ? 'Start a New Session' : 'Get Started'}
          </h2>
          
          <div className="space-y-4 mb-8">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">1</div>
              <div>
                <h3 className="font-semibold text-gray-800">Upload your study material</h3>
                <p className="text-gray-600 text-sm">Add notes, textbook chapters, or any study documents</p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">2</div>
              <div>
                <h3 className="font-semibold text-gray-800">AI extracts ALL topics</h3>
                <p className="text-gray-600 text-sm">We identify every topic and group them into manageable sets</p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">3</div>
              <div>
                <h3 className="font-semibold text-gray-800">Master one set at a time</h3>
                <p className="text-gray-600 text-sm">Take focused quizzes and track your progress</p>
              </div>
            </div>
          </div>

          <button
            onClick={() => setScreen('input')}
            className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-8 rounded-xl transition-all duration-200 transform hover:scale-105"
          >
            <BookOpen size={24} />
            <span className="text-lg">Create New Study Session</span>
          </button>
        </div>
      </div>
      <SurveyModal
        isOpen={showSurveyModal}
        onClose={() => setShowSurveyModal(false)}
        userId={user?.id}
      />
    </div>
    
  );
}

  // Input Screen
  if (screen === 'input') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-3 md:p-6 overflow-y-auto">
        <div className="max-w-4xl mx-auto py-4 md:py-8">
          <button
            onClick={() => setScreen('welcome')}
            className="mb-6 text-blue-600 hover:text-blue-700 flex items-center gap-2"
          >
            ← Back
          </button>

          <div className="text-center mb-8">
            <h1 className="text-2xl md:text-4xl font-bold text-gray-800 mb-4">
            Add Your Study Material
            </h1>
            <p className="text-gray-600">
              Paste your notes or upload a document - we'll extract all topics automatically
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <label className="block mb-6">
              <span className="text-gray-700 font-semibold mb-2 block">
                Session Title *
              </span>
              <input
                type="text"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                placeholder="e.g., Biology Chapter 5 - Cell Structure"
                className="w-full p-4 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
              />
            </label>
            <div className="block mb-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-700 font-semibold">Study Material</span>
                {uploadedFiles.length > 0 && (
                  <span className="text-sm text-gray-500">
                    {(uploadedFiles.reduce((s, f) => s + f.size, 0) / 1000).toFixed(1)} / {MAX_TOTAL_CHARS / 1000}KB used
                  </span>
                )}
              </div>

              {/* File chips */}
              {uploadedFiles.length > 0 && (
                <div className="space-y-2 mb-3">
                  {uploadedFiles.map((f) => (
                    <div key={f.name} className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-blue-600">📄</span>
                          <span className="font-medium text-gray-800 text-sm">{f.name}</span>
                          <span className="text-gray-400 text-xs">{(f.size / 1000).toFixed(1)}KB</span>
                          {editedTexts[f.name] !== undefined && (
                            <span className="text-xs text-purple-600 font-medium">✏️ edited</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setExpandedFile(expandedFile === f.name ? null : f.name)}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded hover:bg-blue-100"
                          >
                            {expandedFile === f.name ? 'Hide' : 'Preview'}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFile(f.name)}
                            className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {/* Expandable text editor */}
                      {expandedFile === f.name && (
                        <div className="mt-3 pt-3 border-t border-blue-200">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs text-gray-500">Edit extracted text</span>
                            {editedTexts[f.name] !== undefined && (
                              <button
                                type="button"
                                onClick={() => setEditedTexts((prev) => { const next = { ...prev }; delete next[f.name]; return next; })}
                                className="text-xs text-purple-600 hover:text-purple-700"
                              >
                                Reset to original
                              </button>
                            )}
                          </div>
                          <textarea
                            value={editedTexts[f.name] ?? f.text}
                            onChange={(e) => setEditedTexts((prev) => ({ ...prev, [f.name]: e.target.value }))}
                            rows={8}
                            className="w-full p-3 border border-blue-200 rounded-lg text-sm font-mono focus:border-blue-500 focus:outline-none resize-y"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Paste area — only show if no files uploaded yet */}
              {uploadedFiles.length === 0 && (
                <textarea
                  value={studyMaterial}
                  onChange={(e) => setStudyMaterial(e.target.value)}
                  placeholder="Paste your study notes, textbook content, or lecture material here..."
                  className="w-full h-48 p-4 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none mb-3"
                />
              )}

              {/* Upload button */}
              <label className="flex items-center gap-2 text-blue-600 hover:text-blue-700 cursor-pointer w-fit">
                <Upload size={18} />
                <span className="font-medium text-sm">
                  {uploadedFiles.length > 0 ? 'Add another file' : 'Upload a file'}
                </span>
                <input
                  type="file"
                  multiple
                  accept=".txt,.md,.pdf,.docx,.doc,.pptx"
                  onChange={handleGeneralFileUpload}
                  className="hidden"
                />
              </label>
            </div>
              <div className="mb-6">
                <label className="block mb-2">
                  <span className="text-gray-700 font-semibold">
                    Context for AI (Optional)
                  </span>
                  <p className="text-sm text-gray-500 mt-1 mb-2">
                    Give the AI additional instructions about how to approach your material
                  </p>
                </label>
                <textarea
                  value={userContext}
                  onChange={(e) => setUserContext(e.target.value)}
                  placeholder="e.g., 'These PDFs are the exact questions from past exams' or 'Focus on application questions rather than memorization' or 'The professor likes to ask multi-topic questions'"
                  className="w-full p-4 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none h-24"
                />
              </div>
            <div className="mb-6">
              <label className="block mb-2">
                <span className="text-gray-700 font-semibold">
                  Questions per quiz
                </span>
              </label>
              <select
                value={numQuestions}
                onChange={(e) => setNumQuestions(parseInt(e.target.value))}
                className="w-full p-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
              >
                <option value={5}>5 questions</option>
                <option value={10}>10 questions</option>
                <option value={15}>15 questions</option>
              </select>
            </div>

            <button
              onClick={handleExtractTopics}
              disabled={loading || (!studyMaterial.trim() && uploadedFiles.length === 0) || !sessionTitle.trim()}
              className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-4 px-8 rounded-xl transition-all duration-200 transform hover:scale-105 disabled:transform-none disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                  <span className="text-lg">Creating Session...</span>
                </>
              ) : (
                <>
                  <Sparkles size={24} />
                  <span className="text-lg">Create Session & Extract Topics</span>
                </>
              )}
            </button>
          </div>
        </div>
        <SurveyModal
        isOpen={showSurveyModal}
        onClose={() => setShowSurveyModal(false)}
        userId={user?.id}
      />
      </div>
    );
  }

  // Topic Selection Screen
  if (screen === 'topic-selection') {
    const completedSets = Object.values(topicSetProgress).filter(p => p.completed).length;
    const totalSets = topicSets.length;
    const totalQuestionsAsked = Object.values(questionHistory).reduce((sum, arr) => sum + arr.length, 0);

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-3 md:p-6 overflow-y-auto">
        <div className="max-w-5xl mx-auto py-4 md:py-8">
          <button
            onClick={() => setScreen('welcome')}
            className="mb-6 text-blue-600 hover:text-blue-700 flex items-center gap-2"
          >
            ← Back to Sessions
          </button>

          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-800 mb-4">
              Your Topic Sets
            </h1>
            <p className="text-gray-600 mb-4">
              We found <span className="font-bold text-blue-600">{allTopics.length} topics</span> in your study material, organized into <span className="font-bold text-blue-600">{totalSets} sets</span> of 5-6 topics each
            </p>
            
            {completedSets > 0 && (
              <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 px-4 py-2 rounded-full">
                <Check size={18} />
                <span className="font-medium">{completedSets} of {totalSets} sets completed</span>
              </div>
            )}
          </div>

          <div className="space-y-4 mb-8">
            {topicSets.map((set, idx) => {
              const progress = topicSetProgress[set.setId] || { completed: false, bestScore: 0, attempts: 0 };
              const isCompleted = progress.completed;
              const scoreColor = progress.bestScore >= 70 ? 'text-green-600' : progress.bestScore >= 50 ? 'text-yellow-600' : 'text-red-600';
              const questionsAsked = getHistoryForTopicSet(set.setId).length;
              
              // Get mastery for this set
              const setMastery = getMasteryForTopicSet(set.setId);
              const hasMastery = Object.keys(setMastery).length > 0;
  
              return (
                <div key={set.setId} className={`bg-white rounded-xl shadow-lg p-4 md:p-6 border-2 ...`}>
                  {/* Mobile: Stack everything vertically */}
                  <div className="flex flex-col md:flex-row md:justify-between md:items-start mb-4 gap-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-2">
                        <h2 className="text-xl md:text-2xl font-bold text-gray-800">Set {set.setNumber}</h2>
                        {isCompleted && (
                          <span className="bg-green-100 text-green-700 px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium flex items-center gap-1">
                            <Check size={14} />
                            Completed
                          </span>
                        )}
                        {questionsAsked > 0 && (
                          <span className="bg-blue-100 text-blue-700 px-2 md:px-3 py-1 rounded-full text-xs font-medium">
                            {questionsAsked} questions asked
                          </span>
                        )}
                      </div>
                      <p className="text-sm md:text-base text-gray-600">{set.name}</p>
                    </div>
                    
                    
                    {/* Score section - now stacks on mobile */}
                    {isCompleted && (
                      <div className="flex md:flex-col items-center md:items-end justify-between md:justify-start gap-4 md:gap-0 md:text-right border-t md:border-t-0 pt-3 md:pt-0">
                        <div>
                          <div className={`text-2xl md:text-3xl font-bold ${scoreColor}`}>
                            {progress.bestScore.toFixed(0)}%
                          </div>
                          <div className="text-xs md:text-sm text-gray-500 whitespace-nowrap">
                            Best Score
                          </div>
                        </div>
                        <div className="text-right md:mt-1">
                          <div className="text-sm md:text-base font-semibold text-gray-700">
                            {progress.attempts}
                          </div>
                          <div className="text-xs md:text-sm text-gray-500 whitespace-nowrap">
                            attempt{progress.attempts !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mb-4">
                    <h3 className="font-semibold text-gray-700 mb-2">Topics in this set:</h3>
                    <div className="grid grid-cols-1 gap-2">
                      {set.topics.map(topic => {
                        const topicData = setMastery[topic.id] || { correct: 0, total: 0 };
                        
                        // Weight-based mastery calculation
                        const baseQuestionsForMastery = 3;
                        const questionsNeeded = baseQuestionsForMastery + (topic.weight * 2);
                        const masteryPercent = Math.min((topicData.correct / questionsNeeded) * 100, 100);
                        
                        let masteryColor = 'bg-gray-300';
                        if (topicData.correct === 0) {
                          masteryColor = 'bg-gray-300';
                        } else if (masteryPercent < 30) {
                          masteryColor = 'bg-red-400';
                        } else if (masteryPercent < 60) {
                          masteryColor = 'bg-yellow-400';
                        } else if (masteryPercent < 90) {
                          masteryColor = 'bg-blue-400';
                        } else {
                          masteryColor = 'bg-green-400';
                        }
                        
                        return (
                          <div key={topic.id} className="bg-blue-50 p-3 rounded-lg">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex-1">
                                <div className="font-medium text-gray-800">{topic.name}</div>
                                <div className="text-sm text-gray-600">{topic.description}</div>
                              </div>
                              {topic.weight && (
                                <div className="ml-3">
                                  <div className="text-xs text-gray-500">Depth</div>
                                  <div className="flex gap-1">
                                    {[1, 2, 3, 4, 5].map(i => (
                                      <div 
                                        key={i} 
                                        className={`w-2 h-2 rounded-full ${i <= topic.weight ? 'bg-blue-600' : 'bg-gray-300'}`}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                            
                            {hasMastery && topicData.total > 0 && (
                              <div className="mt-2">
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-xs text-gray-600">
                                    {topicData.correct}/{topicData.total} correct
                                  </span>
                                  <span className="text-xs text-gray-600">
                                    {masteryPercent.toFixed(0)}% mastery
                                  </span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                  <div 
                                    className={`h-2 rounded-full ${masteryColor} transition-all duration-500`}
                                    style={{ width: `${Math.max(masteryPercent, topicData.correct > 0 ? 5 : 0)}%` }}
                                  ></div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => handleGenerateQuizForSet(idx)}
                      disabled={loading}
                      className="flex-1 flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200"
                    >
                      <Sparkles size={20} />
                      <span>{isCompleted ? 'Practice Again' : 'Start Quiz'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-xl shadow-lg p-6 text-center mb-4">
            <h3 className="text-xl font-bold text-gray-800 mb-2">Overall Progress</h3>
            <div className="flex justify-center gap-8 mb-4">
              <div>
                <div className="text-3xl font-bold text-blue-600">{completedSets}/{totalSets}</div>
                <div className="text-sm text-gray-600">Sets Completed</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-green-600">{allTopics.length}</div>
                <div className="text-sm text-gray-600">Total Topics</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-purple-600">
                  {totalQuestionsAsked}
                </div>
                <div className="text-sm text-gray-600">Questions Asked</div>
              </div>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-4 mb-2">
              <div 
                className="bg-blue-600 h-4 rounded-full transition-all duration-500"
                style={{ width: `${(completedSets / totalSets) * 100}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-600">
              {completedSets === totalSets ? '🎉 All sets completed! Great job!' : `${totalSets - completedSets} set${totalSets - completedSets !== 1 ? 's' : ''} remaining`}
            </p>
          </div>
        </div>
        <SurveyModal
        isOpen={showSurveyModal}
        onClose={() => setShowSurveyModal(false)}
        userId={user?.id}
      />
      </div>
    );
  }

  // Quiz Screen
  if (screen === 'quiz' && questions.length > 0) {
    const q = questions[currentQuestion];
    const isLastQuestion = currentQuestion === questions.length - 1;
    const currentSet = topicSets[currentTopicSetIndex];

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center p-6">
        <div className="max-w-4xl w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex justify-between items-center mb-4">
              <div className="text-gray-500 text-sm font-medium">
                Question {currentQuestion + 1} of {questions.length}
              </div>
              <div className="text-blue-600 text-sm font-medium">
                {currentSet.name}
              </div>
            </div>

           <h2 className="text-xl md:text-2xl font-bold text-gray-800 mb-2">
            {q.question}
            </h2>
            <div className="text-sm text-gray-500 mb-6 pb-6 border-b border-gray-200">
              Topic: {q.topic}
            </div>

            <div className="space-y-4 mb-8">
              {q.options.map((option, idx) => (
                <label
                  key={idx}
                  className={`flex items-start gap-4 p-5 rounded-xl cursor-pointer transition-all duration-200 ${
                    selectedAnswer === idx.toString()
                      ? 'bg-blue-100 border-2 border-blue-500'
                      : 'bg-gray-50 border-2 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="answer"
                    value={idx}
                    checked={selectedAnswer === idx.toString()}
                    onChange={(e) => setSelectedAnswer(e.target.value)}
                    className="mt-1 w-5 h-5 text-blue-600"
                  />
                  <span className="text-lg text-gray-700 flex-1">
                    <span className="font-semibold mr-2">{String.fromCharCode(65 + idx)})</span>
                    {option}
                  </span>
                </label>
              ))}
            </div>

            <div className="flex justify-center">
              <button
                onClick={handleNextQuestion}
                className="flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-8 rounded-xl transition-all duration-200 transform hover:scale-105"
              >
                <span className="text-lg">
                  {isLastQuestion ? 'Finish Quiz' : 'Next Question'}
                </span>
                {isLastQuestion ? <Check size={24} /> : <ArrowRight size={24} />}
              </button>
            </div>
          </div>
        </div>
        <SurveyModal
        isOpen={showSurveyModal}
        onClose={() => setShowSurveyModal(false)}
        userId={user?.id}
      />
      </div>
    );
  }
  // Results Screen
if (screen === 'results') {
  const scorePercent = (score / questions.length) * 100;
  const scoreColor =
    scorePercent >= 70
      ? 'text-green-600'
      : scorePercent >= 50
      ? 'text-yellow-600'
      : 'text-red-600';
  
  const currentSet = topicSets[currentTopicSetIndex];
  const hasNextSet = currentTopicSetIndex < topicSets.length - 1;

  if (!questions || questions.length === 0 || !userAnswers || userAnswers.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
        <div className="max-w-4xl mx-auto py-4 md:py-8 text-center">
          <p className="text-gray-600">Loading results...</p>
          <button
          onClick={() => {
            if (loading) return;
            setScreen('topic-selection');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          disabled={loading||generatingFollowUp}
          className="flex items-center gap-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200"
        >
          <BookOpen size={20} />
          <span>View All Sets</span>
        </button>
        </div>
        <SurveyModal
        isOpen={showSurveyModal}
        onClose={() => setShowSurveyModal(false)}
        userId={user?.id}
      />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-3 md:p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto py-4 md:py-8">
        {/* Score shows IMMEDIATELY */}
        <div className="text-center mb-8">
          <div className="text-7xl mb-4">🎉</div>
          <h1 className="text-4xl font-bold text-gray-800 mb-2">Quiz Complete!</h1>
          <p className="text-gray-600">{currentSet.name}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8 text-center">
          <p className="text-gray-600 text-lg mb-2">Your Score</p>
          <p className={`text-6xl font-bold ${scoreColor} mb-2`}>
            {score}/{questions.length}
          </p>
          <p className="text-2xl text-gray-500">{scorePercent.toFixed(1)}%</p>
          
          {scorePercent >= 70 && (
            <div className="mt-4 inline-block bg-green-100 text-green-700 px-4 py-2 rounded-full">
              <span className="font-medium">Great job! You're ready to move forward 🚀</span>
            </div>
          )}
        </div>

        {/* AI Analysis - loads after */}
        {loading ? (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">AI is analyzing your performance...</p>
          </div>
        ) : analysis ? (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
            <div className="flex items-center gap-3 mb-4">
              <Brain className="text-blue-600" size={24} />
              <h2 className="text-2xl font-bold text-gray-800">AI Analysis</h2>
            </div>
            <p className="text-gray-700 mb-4">{analysis}</p>
            
            {topicsToReview.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4">
                <h3 className="font-semibold text-gray-800 mb-2">Topics to Review:</h3>
                <ul className="list-disc list-inside text-gray-700 space-y-1">
                  {topicsToReview.map((topic, idx) => (
                    <li key={idx}>{topic}</li>
                  ))}
                </ul>
              </div>
            )}

            {paginatedStudyGuide.length > 0 && (
              <div className="mt-6">
                <h3 className="text-xl font-semibold text-gray-800 mb-4">
                  {paginatedStudyGuide[currentStudyTopic].topic}
                </h3>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-700">
                  {paginatedStudyGuide[currentStudyTopic].content.map((point, idx) => (
                    <li key={idx}>{point}</li>
                  ))}
                </ul>
                <div className="flex justify-between">
                  <button
                    onClick={() => setCurrentStudyTopic(prev => Math.max(prev - 1, 0))}
                    disabled={currentStudyTopic === 0}
                    className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentStudyTopic(prev => Math.min(prev + 1, paginatedStudyGuide.length - 1))}
                    disabled={currentStudyTopic === paginatedStudyGuide.length - 1}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
                <p className="text-gray-500 text-sm mt-4 text-center">
                  Topic {currentStudyTopic + 1} of {paginatedStudyGuide.length}
                </p>
              </div>
            )}
          </div>
        ) : null}

        {/* Detailed Results - shows immediately with loading states for explanations */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">Detailed Results</h2>
          <div className="space-y-6">
            {userAnswers.map((answerIdx, i) => {
              const q = questions[i];
              if (!q || !q.options || !Array.isArray(q.options)) {
                console.error('Invalid question at index', i, q);
                return null;
              }
              const userAnswer = q.options[answerIdx];
              const correctAnswer = q.correct;
              const isCorrect = userAnswer === correctAnswer;
              const isExpanded = expandedQuestion === i;
              const explanation = questionExplanations[i];
              const isLoadingExplanation = loadingExplanation === i;

              return (
                <div key={i} className="border-2 border-gray-200 rounded-lg p-6">
                  <div className="flex items-start gap-3 mb-3">
                    <span className={`font-bold text-lg ${isCorrect ? 'text-green-600' : 'text-red-600'}`}>
                      {isCorrect ? '✓' : '✗'}
                    </span>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-800 mb-2">
                        Question {i + 1}: {q.question}
                      </h3>
                      <p className={`mb-1 ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                        <span className="font-medium">Your answer:</span> {userAnswer}
                      </p>
                      {!isCorrect && (
                        <p className="text-green-700">
                          <span className="font-medium">Correct answer:</span> {correctAnswer}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => handleGetExplanation(i)}
                    className="mt-3 flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium transition-colors"
                  >
                    <Brain size={18} />
                    <span>{isExpanded ? 'Hide' : 'Get AI'} Explanation</span>
                  </button>

                  {isExpanded && (
                    <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                      {isLoadingExplanation ? (
                        <div className="flex items-center gap-3 text-blue-600">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                          <span>Generating explanation...</span>
                        </div>
                      ) : (
                        <div className="text-gray-700 whitespace-pre-wrap">
                          {explanation}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Topic Mastery - shows with loading placeholder if not ready */}
        {topics.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
            <div className="flex items-center gap-3 mb-4">
              <BookOpen className="text-blue-600" size={24} />
              <h2 className="text-2xl font-bold text-gray-800">Topic Mastery - {currentSet.name}</h2>
            </div>
            
            <div className="space-y-4">
              {topics.map(topic => {
                const setMastery = getMasteryForTopicSet(currentSet.setId);
                const topicData = setMastery[topic.id] || { correct: 0, total: 0 };

                const baseQuestionsForMastery = 3;
                const questionsNeeded = baseQuestionsForMastery + (topic.weight * 2);
                const masteryPercent = Math.min((topicData.correct / questionsNeeded) * 100, 100);

                let masteryLevel = 'Not Started';
                let masteryColor = 'text-gray-500';
                let barColor = 'bg-gray-300';

                if (topicData.correct === 0) {
                  masteryLevel = 'Not Started';
                  masteryColor = 'text-gray-500';
                  barColor = 'bg-gray-300';
                } else if (masteryPercent < 30) {
                  masteryLevel = 'Beginner';
                  masteryColor = 'text-red-600';
                  barColor = 'bg-red-400';
                } else if (masteryPercent < 60) {
                  masteryLevel = 'Learning';
                  masteryColor = 'text-yellow-600';
                  barColor = 'bg-yellow-400';
                } else if (masteryPercent < 90) {
                  masteryLevel = 'Proficient';
                  masteryColor = 'text-blue-600';
                  barColor = 'bg-blue-400';
                } else {
                  masteryLevel = 'Mastery';
                  masteryColor = 'text-green-600';
                  barColor = 'bg-green-400';
                }
                
                return (
                  <div key={topic.id} className="border-2 border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-800 text-lg">{topic.name}</h3>
                        <p className="text-sm text-gray-600 mt-1">{topic.description}</p>
                      </div>
                      <div className="text-right ml-4">
                        <div className={`font-bold text-lg ${masteryColor}`}>
                          {masteryLevel}
                        </div>
                        <div className="text-sm text-gray-500">
                          {topicData.correct}/{topicData.total} correct
                          {topicData.total > 0 && ` (${((topicData.correct/topicData.total)*100).toFixed(0)}%)`}
                        </div>
                      </div>
                    </div>
                    
                    <div className="relative">
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div 
                          className={`h-3 rounded-full ${barColor} transition-all duration-500`}
                          style={{ width: `${Math.max(masteryPercent, topicData.correct > 0 ? 5 : 0)}%` }}
                        ></div>
                      </div>
                      <div className="text-xs text-gray-500 mt-1 text-right">
                        {masteryPercent.toFixed(0)}% mastery ({topicData.correct}/{questionsNeeded} needed)
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Rest of the results screen remains the same */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <h3 className="text-xl font-semibold text-gray-800 mb-2">Customize Next Quiz</h3>
          <p className="text-gray-600 mb-4 text-sm">
            Optionally, give instructions to the AI for your next quiz
          </p>
          <textarea
            value={userFeedback}
            onChange={(e) => setUserFeedback(e.target.value)}
            placeholder="E.g., 'Focus more on molecular biology' or 'Include more application questions'"
            className="w-full p-4 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none h-24"
          />
        </div>

        <div className="flex gap-4 justify-center flex-wrap mb-8">
          <button
          onClick={handleGenerateFollowUp}
          disabled={generatingFollowUp || loading}
          className="flex items-center gap-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold py-4 px-8 rounded-xl transition-all duration-200 transform hover:scale-105 disabled:transform-none disabled:cursor-not-allowed"
        >
          {generatingFollowUp || loading ? (
            <>
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
              <span className="text-lg">Generating...</span>
            </>
          ) : (
            <>
              <Brain size={24} />
              <span className="text-lg">Practice This Set Again</span>
            </>
          )}
        </button>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <h3 className="text-xl font-semibold text-gray-800 mb-4 text-center">Navigate Topic Sets</h3>
          
          <div className="flex items-center justify-between gap-4">
            <button
            onClick={() => {
              if (loading || generatingFollowUp) return;
              setScreen('topic-selection');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            disabled={loading || generatingFollowUp}
            className="flex items-center gap-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200"
          >
            <BookOpen size={20} />
            <span>View All Sets</span>
          </button>

            {hasNextSet && scorePercent >= 70 && (
            <button
              onClick={() => handleGenerateQuizForSet(currentTopicSetIndex + 1)}
              disabled={loading|| generatingFollowUp}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <span>Generating...</span>
                </>
              ) : (
                <>
                  <span>Next Set</span>
                  <ChevronRight size={20} />
                </>
              )}
            </button>
          )}
          </div>

          <button
          onClick={handleRestart}
          disabled={loading|| generatingFollowUp}
          className="w-full mt-4 flex items-center justify-center gap-3 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200"
        >
          <RotateCcw size={20} />
          <span>Back to Sessions</span>
          </button>
        </div>
      </div>
      <SurveyModal
        isOpen={showSurveyModal}
        onClose={() => setShowSurveyModal(false)}
        userId={user?.id}
      />
    </div>
  );
}


 return (
    <>
      {/* Survey Modal - shows on top of any screen */}
      <SurveyModal
        isOpen={showSurveyModal}
        onClose={() => setShowSurveyModal(false)}
        userId={user?.id}
      />
    </>
  );
}

export default QuizApp;