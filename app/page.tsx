'use client';

import { useState, useRef, useEffect } from 'react';
import ePub from 'epubjs';

interface Sentence {
  text: string;
  startIndex: number;
  endIndex: number;
}

export default function Home() {
  const [epubFile, setEpubFile] = useState<File | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const bookRef = useRef<any | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const sentenceRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (utteranceRef.current) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const splitIntoSentences = (text: string): Sentence[] => {
    // Clean up the text - remove extra whitespace
    const cleanedText = text.replace(/\s+/g, ' ').trim();
    
    if (!cleanedText) {
      return [];
    }

    // Split by sentence-ending punctuation followed by space or newline
    // This regex matches: . ! ? followed by whitespace
    const sentenceEndings = /([.!?]+)\s+/g;
    const sentences: Sentence[] = [];
    let lastIndex = 0;
    let match;

    while ((match = sentenceEndings.exec(cleanedText)) !== null) {
      const sentenceText = cleanedText.substring(lastIndex, match.index + match[1].length).trim();
      if (sentenceText.length > 0) {
        sentences.push({
          text: sentenceText,
          startIndex: lastIndex,
          endIndex: match.index + match[1].length,
        });
      }
      lastIndex = match.index + match[0].length;
    }

    // Add the last sentence if there's remaining text
    if (lastIndex < cleanedText.length) {
      const remainingText = cleanedText.substring(lastIndex).trim();
      if (remainingText.length > 0) {
        sentences.push({
          text: remainingText,
          startIndex: lastIndex,
          endIndex: cleanedText.length,
        });
      }
    }

    // If no sentences found (no sentence-ending punctuation), split by line breaks or treat as one
    if (sentences.length === 0) {
      const lines = cleanedText.split(/\n+/).filter(line => line.trim().length > 0);
      if (lines.length > 1) {
        let currentIndex = 0;
        lines.forEach((line) => {
          const trimmedLine = line.trim();
          if (trimmedLine.length > 0) {
            const startIndex = cleanedText.indexOf(trimmedLine, currentIndex);
            sentences.push({
              text: trimmedLine,
              startIndex,
              endIndex: startIndex + trimmedLine.length,
            });
            currentIndex = startIndex + trimmedLine.length;
          }
        });
      } else {
        sentences.push({
          text: cleanedText,
          startIndex: 0,
          endIndex: cleanedText.length,
        });
      }
    }

    return sentences;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.epub')) {
      setError('Please upload a valid .epub file');
      return;
    }

    setEpubFile(file);
    setError(null);
    setIsLoading(true);
    setSentences([]);
    setCurrentSentenceIndex(null);

    let blobUrl: string | null = null;

    try {
      console.log('Starting EPUB parsing...');
      
      // Read file as ArrayBuffer using FileReader (more reliable)
      const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target?.result instanceof ArrayBuffer) {
            resolve(e.target.result);
          } else {
            reject(new Error('Failed to read file as ArrayBuffer'));
          }
        };
        reader.onerror = () => reject(new Error('FileReader error'));
        reader.readAsArrayBuffer(file);
      });

      console.log('File read, creating EPUB book...');
      
      // Create a blob URL for epubjs (required for browser usage)
      const blob = new Blob([arrayBuffer], { type: 'application/epub+zip' });
      blobUrl = URL.createObjectURL(blob);
      
      // Initialize epubjs with options object (required for proper initialization)
      const book = ePub(blobUrl, {
        openAs: 'epub'
      });
      bookRef.current = book;

      console.log('Waiting for book to be ready...');
      
      // Try multiple approaches to detect when book is ready
      let bookReady = false;
      
      try {
        // Approach 1: Use the ready promise with timeout
        await Promise.race([
          book.ready.then(() => {
            console.log('Book ready promise resolved');
            bookReady = true;
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 10000)
          )
        ]);
      } catch (err) {
        console.warn('Ready promise timed out, trying alternative approach...');
        
        // Approach 2: Wait a bit and try to access spine directly
        // Sometimes the book is ready but the promise doesn't resolve
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Try to access spine to see if book is actually ready
        try {
          if (book.spine) {
            // Try to get the first item to verify spine is accessible
            const testSection = book.spine.get(0);
            if (testSection) {
              console.log('Book appears ready (spine accessible), continuing...');
              bookReady = true;
            } else {
              throw new Error('Spine exists but cannot get first section');
            }
          } else {
            throw new Error('Spine not accessible');
          }
        } catch (spineErr) {
          console.error('Cannot access spine:', spineErr);
          throw new Error('EPUB parsing failed - book did not become ready. The EPUB file might be corrupted or incompatible.');
        }
      }

      console.log('Book ready, accessing spine...');

      // Get the spine (list of chapters)
      const spine = book.spine;
      if (!spine) {
        throw new Error('No spine found in the EPUB file');
      }

      console.log('Finding first content chapter (skipping cover)...');

      // Get all spine items and find the first one with actual content
      // Skip cover pages and other non-content pages
      let textContent = '';
      let foundContent = false;
      const maxChaptersToTry = 10; // Limit to prevent infinite loops
      
      for (let i = 0; i < maxChaptersToTry; i++) {
        const section = spine.get(i);
        if (!section) {
          console.log(`No section at index ${i}, stopping search`);
          break;
        }

        console.log(`Trying section ${i}: ${section.href}`);

        // Load the section
        const loadedSection = await book.load(section.href);
      
        console.log('Section loaded, extracting text...', typeof loadedSection);
        
        // Extract text content - section can be a string, Document, or other format
        let doc: Document | null = null;
      
        if (typeof loadedSection === 'string') {
        console.log('Section is string, parsing as HTML/XHTML...');
        // Try parsing as XHTML first (common in EPUB), then HTML
        try {
          const parser = new DOMParser();
          doc = parser.parseFromString(loadedSection, 'application/xhtml+xml');
          // Check for parsing errors
          if (doc.querySelector('parsererror')) {
            console.log('XHTML parsing failed, trying HTML...');
            doc = parser.parseFromString(loadedSection, 'text/html');
          }
        } catch (err) {
          console.log('Parser error, trying HTML:', err);
          const parser = new DOMParser();
          doc = parser.parseFromString(loadedSection, 'text/html');
        }
        } else if (loadedSection instanceof Document) {
          console.log('Section is Document');
          doc = loadedSection;
        } else if (loadedSection && typeof loadedSection === 'object') {
          console.log('Section is object, trying to extract content...');
          // Try to get innerHTML or textContent from the object
          if ('innerHTML' in loadedSection) {
            const parser = new DOMParser();
            doc = parser.parseFromString(String(loadedSection.innerHTML), 'text/html');
          } else if ('textContent' in loadedSection) {
            textContent = String(loadedSection.textContent);
          } else {
            // Try to convert to string and parse
            const parser = new DOMParser();
            doc = parser.parseFromString(String(loadedSection), 'text/html');
          }
        }
      
        // Extract text from document if we have one
        if (doc) {
          console.log('Extracting from document, body:', doc.body);
          // Remove script and style elements
          const scripts = doc.querySelectorAll('script, style, nav, header, footer');
          scripts.forEach(el => el.remove());
          
          // Try different methods to get text
          let extractedText = doc.body?.textContent || doc.body?.innerText || '';
          
          // If body is empty, try getting text from all elements
          if (!extractedText.trim() && doc.documentElement) {
            const allText = doc.documentElement.textContent || doc.documentElement.innerText || '';
            if (allText.trim()) {
              extractedText = allText;
              console.log('Used documentElement text');
            }
          }
          
          // Try getting text from common content containers
          if (!extractedText.trim()) {
            const contentSelectors = ['main', 'article', 'section', 'div[class*="content"]', 'p'];
            for (const selector of contentSelectors) {
              const elements = doc.querySelectorAll(selector);
              if (elements.length > 0) {
                extractedText = Array.from(elements)
                  .map(el => el.textContent || (el as HTMLElement).innerText || '')
                  .join(' ')
                  .trim();
                if (extractedText) {
                  console.log(`Found text using selector: ${selector}`);
                  break;
                }
              }
            }
          }
          
          textContent = extractedText;
        }
        
        console.log(`Text extracted from section ${i}, length:`, textContent.length);
        console.log('Text preview (first 200 chars):', textContent.substring(0, 200));
        
        // Check if this section has substantial content (not just a cover)
        const trimmedText = textContent.trim().toLowerCase();
        const isLikelyCover = 
          trimmedText.length < 50 || // Very short content
          trimmedText === 'cover' ||
          trimmedText.includes('title page') ||
          trimmedText.includes('copyright') ||
          (trimmedText.split(/\s+/).length < 10); // Less than 10 words
        
        if (trimmedText.length > 0 && !isLikelyCover) {
          console.log(`Found content chapter at index ${i}!`);
          foundContent = true;
          break; // Found a good chapter, stop searching
        } else {
          console.log(`Section ${i} appears to be a cover or has no content, trying next...`);
          textContent = ''; // Reset for next iteration
        }
      }
      
      if (!textContent.trim() || !foundContent) {
        // Log more details for debugging
        console.error('No substantial text content found in any chapter.');
        throw new Error('No text content found in the EPUB. The file might only contain images or unsupported content.');
      }

      // Split into sentences
      const extractedSentences = splitIntoSentences(textContent);
      console.log('Sentences extracted:', extractedSentences.length);
      setSentences(extractedSentences);
    } catch (err) {
      console.error('Error parsing EPUB:', err);
      setError(err instanceof Error ? err.message : 'Failed to parse EPUB file. Check console for details.');
    } finally {
      // Clean up blob URL
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
      setIsLoading(false);
    }
  };

  const handlePlay = () => {
    if (sentences.length === 0) {
      setError('Please upload and parse an EPUB file first');
      return;
    }

    // If currently paused, resume
    if (!isPlaying && window.speechSynthesis.paused && currentSentenceIndex !== null) {
      window.speechSynthesis.resume();
      setIsPlaying(true);
      console.log('Speech resumed from Play button');
      return;
    }

    if (isPlaying) {
      // Pause (not cancel)
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
      }
      setIsPlaying(false);
      // Keep currentSentenceIndex so we can resume from here
      console.log('Speech paused from Play button');
      return;
    }

    // Check if speech synthesis is available
    if (!('speechSynthesis' in window)) {
      setError('Speech synthesis is not supported in this browser');
      return;
    }

    // Start playing from the beginning or resume
    const startIndex = currentSentenceIndex !== null ? currentSentenceIndex : 0;
    const textToRead = sentences.slice(startIndex).map(s => s.text).join(' ').trim();

    if (!textToRead) {
      return;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(textToRead);
      utteranceRef.current = utterance;

      // Set language and voice properties
      utterance.lang = 'en-US';
      utterance.rate = 1;
      utterance.pitch = 1;

      // Track character position to highlight sentences
      let charCount = 0;
      const sentenceStartIndices = sentences.slice(startIndex).map((s, idx) => {
        const start = charCount;
        charCount += s.text.length + 1; // +1 for space
        return { index: startIndex + idx, charStart: start };
      });

      utterance.onboundary = (event) => {
        try {
          if (event.name === 'word' || event.name === 'sentence') {
            const currentCharIndex = event.charIndex;
            
            // Find which sentence we're currently in
            for (let i = sentenceStartIndices.length - 1; i >= 0; i--) {
              const { index, charStart } = sentenceStartIndices[i];
              if (currentCharIndex >= charStart) {
                setCurrentSentenceIndex(index);
                
                // Scroll to the sentence
                if (sentenceRefs.current[index]) {
                  sentenceRefs.current[index]?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                  });
                }
                break;
              }
            }
          }
        } catch (err) {
          console.warn('Error in onboundary handler:', err);
        }
      };

      utterance.onend = () => {
        setIsPlaying(false);
        setCurrentSentenceIndex(null);
      };

      utterance.onerror = (event) => {
        // Log all error details for debugging
        console.log('Speech onerror triggered:', {
          error: event.error,
          type: event.type,
          charIndex: event.charIndex,
          eventObject: event
        });

        // Check if this is a normal cancellation/interruption (which is expected when clicking new sentences)
        // When speech is canceled, event.error is often undefined or might be 'canceled' or 'interrupted'
        const isCancellation = !event.error || event.error === 'canceled' || event.error === 'interrupted';

        if (isCancellation) {
          // This is a normal cancellation, just silently handle it
          console.log('Detected as cancellation, handling silently');
          setIsPlaying(false);
          setCurrentSentenceIndex(null);
          return;
        }

        // This is an actual error, log it
        const errorInfo = {
          error: event.error,
          type: event.type,
          charIndex: event.charIndex,
          utterance: {
            text: utterance.text?.substring(0, 50),
            lang: utterance.lang,
          }
        };
        console.error('Speech synthesis error (REAL ERROR):', errorInfo);
        setError(`Speech synthesis error: ${event.error || 'Unknown error'}`);
        
        setIsPlaying(false);
        setCurrentSentenceIndex(null);
      };

      utterance.onstart = () => {
        setCurrentSentenceIndex(startIndex);
        setIsPlaying(true);
      };

      // Check if speech synthesis is actually available
      if (window.speechSynthesis.getVoices().length === 0) {
        // Voices might not be loaded yet, wait a bit
        window.speechSynthesis.addEventListener('voiceschanged', () => {
          // Cancel before speak to prevent intermittent issues
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        }, { once: true });
      } else {
        // Cancel before speak to prevent intermittent issues
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }
    } catch (err) {
      console.error('Error creating speech utterance:', err);
      setError('Failed to start speech synthesis. Please try again.');
    }
  };

  const handleSentenceClick = (index: number) => {
    // If clicking the same sentence that's currently playing, pause/resume it
    if (isPlaying && currentSentenceIndex === index) {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        // Pause the speech
        window.speechSynthesis.pause();
        setIsPlaying(false);
        // Keep the sentence highlighted (don't change currentSentenceIndex)
        console.log('Speech paused at sentence', index);
        return;
      } else if (window.speechSynthesis.paused) {
        // Resume the speech
        window.speechSynthesis.resume();
        setIsPlaying(true);
        console.log('Speech resumed at sentence', index);
        return;
      }
    }

    // Stop current playback (different sentence clicked)
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setCurrentSentenceIndex(null);

    // Start playing from clicked sentence
    const textToRead = sentences.slice(index).map(s => s.text).join(' ').trim();

    if (!textToRead) {
      console.warn('No text to read for sentence at index', index);
      return;
    }

    // Check if speech synthesis is available
    if (!('speechSynthesis' in window)) {
      setError('Speech synthesis is not supported in this browser');
      return;
    }

    // Wait a bit after canceling to ensure speech synthesis is ready
    setTimeout(() => {
      try {
        const utterance = new SpeechSynthesisUtterance(textToRead);
        utteranceRef.current = utterance;

        // Set language (optional, but can help)
        utterance.lang = 'en-US';
        
        // Set rate and pitch for better experience
        utterance.rate = 1;
        utterance.pitch = 1;

        // Track character position
        let charCount = 0;
        const sentenceStartIndices = sentences.slice(index).map((s, idx) => {
          const start = charCount;
          charCount += s.text.length + 1; // +1 for space
          return { index: index + idx, charStart: start };
        });

        utterance.onboundary = (event) => {
          try {
            if (event.name === 'word' || event.name === 'sentence') {
              const currentCharIndex = event.charIndex;
              
              for (let i = sentenceStartIndices.length - 1; i >= 0; i--) {
                const { index: sentenceIdx, charStart } = sentenceStartIndices[i];
                if (currentCharIndex >= charStart) {
                  setCurrentSentenceIndex(sentenceIdx);
                  
                  if (sentenceRefs.current[sentenceIdx]) {
                    sentenceRefs.current[sentenceIdx]?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center',
                    });
                  }
                  break;
                }
              }
            }
          } catch (err) {
            console.warn('Error in onboundary handler:', err);
          }
        };

        utterance.onend = () => {
          setIsPlaying(false);
          setCurrentSentenceIndex(null);
        };

        utterance.onerror = (event) => {
          // Log all error details for debugging
          console.log('Speech onerror triggered:', {
            error: event.error,
            type: event.type,
            charIndex: event.charIndex,
            eventObject: event
          });

          // Check if this is a normal cancellation/interruption (which is expected when clicking new sentences)
          // When speech is canceled, event.error is often undefined or might be 'canceled' or 'interrupted'
          const isCancellation = !event.error || event.error === 'canceled' || event.error === 'interrupted';

          if (isCancellation) {
            // This is a normal cancellation, just silently handle it
            console.log('Detected as cancellation, handling silently');
            setIsPlaying(false);
            setCurrentSentenceIndex(null);
            return;
          }

          // This is an actual error, log it
          const errorInfo = {
            error: event.error,
            type: event.type,
            charIndex: event.charIndex,
            utterance: {
              text: utterance.text?.substring(0, 50),
              lang: utterance.lang,
            }
          };
          console.error('Speech synthesis error (REAL ERROR):', errorInfo);
          setError(`Speech synthesis error: ${event.error || 'Unknown error'}`);
          
          setIsPlaying(false);
          setCurrentSentenceIndex(null);
        };

        utterance.onstart = () => {
          setCurrentSentenceIndex(index);
          setIsPlaying(true);
        };

        // Check if speech synthesis is actually available
        if (window.speechSynthesis.getVoices().length === 0) {
          // Voices might not be loaded yet, wait a bit
          window.speechSynthesis.addEventListener('voiceschanged', () => {
            // Cancel before speak to prevent intermittent issues
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utterance);
          }, { once: true });
        } else {
          // Cancel before speak to prevent intermittent issues
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        }
      } catch (err) {
        console.error('Error creating speech utterance:', err);
        setError('Failed to start speech synthesis. Please try again.');
      }
    }, 100); // Small delay to ensure previous speech is fully cancelled
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-50 mb-2">
            Voxe
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            AI E-book Reader
          </p>
        </header>

        {/* File Upload Section */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6 mb-6">
          <label className="block mb-4">
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Upload EPUB File
            </span>
            <input
              type="file"
              accept=".epub"
              onChange={handleFileUpload}
              className="block w-full text-sm text-slate-500 dark:text-slate-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-lg file:border-0
                file:text-sm file:font-semibold
                file:bg-blue-50 file:text-blue-700
                hover:file:bg-blue-100
                dark:file:bg-blue-900 dark:file:text-blue-200
                dark:hover:file:bg-blue-800
                cursor-pointer"
              disabled={isLoading}
            />
          </label>

          {epubFile && (
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Selected: {epubFile.name}
            </p>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {isLoading && (
            <div className="mt-4 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-slate-600 dark:text-slate-400">Parsing EPUB...</span>
            </div>
          )}
        </div>

        {/* Play Button */}
        {sentences.length > 0 && (
          <div className="mb-6 flex justify-center">
            <button
              onClick={handlePlay}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isLoading}
            >
              {isPlaying ? '⏸️ Pause' : (!isPlaying && currentSentenceIndex !== null) ? '▶️ Resume' : '▶️ Play'}
            </button>
          </div>
        )}

        {/* Sentences Display */}
        {sentences.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50 mb-4">
              First Chapter
            </h2>
            <div className="prose prose-slate dark:prose-invert max-w-none">
              <div className="space-y-3 text-slate-700 dark:text-slate-300 leading-relaxed">
                {sentences.map((sentence, index) => (
                  <span
                    key={index}
                    ref={(el) => { sentenceRefs.current[index] = el; }}
                    onClick={() => handleSentenceClick(index)}
                    className={`inline-block cursor-pointer px-2 py-1 rounded transition-all duration-200 ${
                      currentSentenceIndex === index
                        ? 'bg-yellow-200 dark:bg-yellow-900/50 text-slate-900 dark:text-slate-50 font-medium scale-105'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {sentence.text}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {sentences.length === 0 && !isLoading && !error && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-12 text-center">
            <p className="text-slate-500 dark:text-slate-400">
              Upload an EPUB file to get started
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
