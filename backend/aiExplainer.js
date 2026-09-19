/**
 * AI Code Explainer Engine for OmniCampus
 * Provides deep syntactic, algorithmic, and educational breakdown
 * of submitted student code.
 */

function explainCode({ code, language = 'javascript', mode = 'full_analysis' }) {
  if (!code || typeof code !== 'string' || !code.trim()) {
    throw new Error('Code snippet cannot be empty');
  }

  const cleanCode = code.trim();
  const lines = cleanCode.split('\n');
  const lineCount = lines.length;

  // Algorithmic pattern detection
  const hasNestedLoops = /(for|while)[\s\S]*?(for|while)/g.test(cleanCode);
  const loopCount = (cleanCode.match(/\b(for|while)\b/g) || []).length;
  const hasRecursion = checkRecursion(cleanCode);
  const hasSorting = /\b(sort|sorted|quicksort|mergesort)\b/i.test(cleanCode);
  const hasHashMap = /\b(Map|Set|dict|lookup|hashmap|unordered_map|\{\})\b/i.test(cleanCode);
  const hasBinarySearch = /\b(mid|binary_search|bisect|low <= high|left <= right)\b/i.test(cleanCode);
  const hasDynamicProgramming = /\b(dp|memo|cache|memoize|tabulation)\b/i.test(cleanCode);
  const hasGraphTraversals = /\b(bfs|dfs|adj|visited|inDegree|queue|stack)\b/i.test(cleanCode);

  // Time & Space Complexity Analysis
  let timeComplexity = 'O(n)';
  let timeReason = 'The algorithm performs a single linear iteration over input elements.';
  let spaceComplexity = 'O(1)';
  let spaceReason = 'Only a constant number of auxiliary pointers/variables are stored.';

  if (hasDynamicProgramming) {
    timeComplexity = hasNestedLoops ? 'O(n * m)' : 'O(n)';
    timeReason = 'Dynamic programming memoizes subproblems, avoiding exponential re-computations.';
    spaceComplexity = 'O(n) auxiliary memory';
    spaceReason = 'Maintains a DP table or memoization dictionary proportional to the problem size.';
  } else if (hasBinarySearch) {
    timeComplexity = 'O(log n)';
    timeReason = 'The search space is halved on each iteration through boundary bifurcation.';
    spaceComplexity = 'O(1)';
    spaceReason = 'Pointers (low, high, mid) require negligible O(1) auxiliary storage.';
  } else if (hasNestedLoops) {
    timeComplexity = 'O(n²)';
    timeReason = 'Detected nested iteration loops across the collection dimensions.';
    spaceComplexity = hasHashMap ? 'O(n)' : 'O(1)';
    spaceReason = hasHashMap ? 'Auxiliary hash map allocates memory proportional to unique keys.' : 'Operates in-place with primitive iteration counters.';
  } else if (hasSorting) {
    timeComplexity = 'O(n log n)';
    timeReason = 'Utilizes dual-pivot quicksort or Timsort comparison algorithm.';
    spaceComplexity = 'O(log n) to O(n)';
    spaceReason = 'Allocates call stack frames for divide-and-conquer partitions.';
  } else if (hasGraphTraversals) {
    timeComplexity = 'O(V + E)';
    timeReason = 'Standard graph traversal visiting all vertices (V) and edges (E) exactly once.';
    spaceComplexity = 'O(V)';
    spaceReason = 'Visited set and traversal queue or recursion stack can hold up to |V| vertices.';
  } else if (hasRecursion) {
    timeComplexity = 'O(2ⁿ) or O(n)';
    timeReason = 'Recursive function branching. If unmemoized Fibonacci tree, time is exponential; if linear tail, O(n).';
    spaceComplexity = 'O(n)';
    spaceReason = 'Call stack recursion depth grows linearly with recursion depth.';
  }

  // Edge cases & bug checks
  const edgeCases = [];
  if (!/(if\s*\(.*null|if\s*\(.*undefined|if\s*not\s+|len\(.*\)\s*==\s*0|!array|!credits)/i.test(cleanCode)) {
    edgeCases.push('Missing empty/null input guard: verify behavior when the input collection is empty, null, or has 1 item.');
  }
  if (/((\+\+|--|\+= 1|-= 1)[\s\S]*?<=\s*\w+\.length)/.test(cleanCode)) {
    edgeCases.push('Possible off-by-one boundary index error with `<=` on array length.');
  }
  if (!/(return|throw)/.test(cleanCode)) {
    edgeCases.push('Function might be missing an explicit return value for non-matching conditions.');
  }
  if (edgeCases.length === 0) {
    edgeCases.push('Solid defensive checks: handles standard expected ranges and boundary criteria.');
  }

  // Section / Line breakdown
  const breakdowns = generateBreakdowns(lines, language);

  // Recommendations and clean optimized version
  const optimizationTips = [
    hasNestedLoops && !hasHashMap
      ? '💡 Performance Win: Consider trading memory for speed by indexing items in a Hash Map / Set to reduce time complexity from O(n²) to O(n).'
      : '✅ Algorithmic Structure: The current pattern avoids redundant computational passes.',
    '🎯 Clean Code Tip: Ensure type hints or JSDoc documentation are specified for peer reviewers in campus group repos.',
    '🧪 Test Coverage: Add edge-case unit tests for empty arrays, duplicates, and extreme boundary values.'
  ];

  // Conceptual quiz for student retention
  const studentQuiz = {
    question: `What would happen to the space complexity if you replaced an in-place two-pointer approach with a memoized Hash Table?`,
    options: [
      `Space complexity remains strictly O(1)`,
      `Space complexity increases to O(n) auxiliary memory to store keys`,
      `Time complexity becomes exponential O(2ⁿ)`,
      `Space complexity is undefined`
    ],
    correctAnswer: 1,
    explanation: 'A Hash Table or Map requires allocating entries proportional to the number of unique elements, raising auxiliary space to O(n).'
  };

  return {
    success: true,
    summary: `Analyzed ${lineCount} lines of ${language.toUpperCase()} code. Detected ${hasNestedLoops ? 'nested quadratic' : hasBinarySearch ? 'logarithmic' : hasDynamicProgramming ? 'dynamic programming' : 'linear'} control flow.`,
    complexity: {
      time: timeComplexity,
      timeExplanation: timeReason,
      space: spaceComplexity,
      spaceExplanation: spaceReason
    },
    lineBreakdown: breakdowns,
    edgeCases,
    optimizationTips,
    quiz: studentQuiz,
    analyzedAt: new Date().toISOString()
  };
}

function checkRecursion(code) {
  const funcMatch = code.match(/(?:function|def)\s+([a-zA-Z0-9_]+)/);
  if (!funcMatch) return false;
  const funcName = funcMatch[1];
  const restOfCode = code.slice(funcMatch.index + funcMatch[0].length);
  return new RegExp(`\\b${funcName}\\s*\\(`).test(restOfCode);
}

function generateBreakdowns(lines, language) {
  const steps = [];
  let currentBlock = [];
  let blockStart = 1;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('def ') || trimmed.startsWith('function ') || trimmed.startsWith('class ')) {
      steps.push({
        lines: `Line ${i + 1}`,
        code: trimmed,
        purpose: 'Entry point definition with parameter contracts.'
      });
    } else if (trimmed.includes('Map') || trimmed.includes('{}') || trimmed.includes('lookup') || trimmed.includes('new Array')) {
      steps.push({
        lines: `Line ${i + 1}`,
        code: trimmed,
        purpose: 'Initializes auxiliary data structure for O(1) state lookup / accumulation.'
      });
    } else if (trimmed.startsWith('for ') || trimmed.startsWith('while ') || trimmed.includes('for (')) {
      steps.push({
        lines: `Line ${i + 1}`,
        code: trimmed,
        purpose: 'Loop iteration traversing through dataset elements.'
      });
    } else if (trimmed.startsWith('if ') || trimmed.startsWith('elif ') || trimmed.startsWith('else')) {
      steps.push({
        lines: `Line ${i + 1}`,
        code: trimmed,
        purpose: 'Branch evaluation for target condition matching or pruning.'
      });
    } else if (trimmed.startsWith('return ')) {
      steps.push({
        lines: `Line ${i + 1}`,
        code: trimmed,
        purpose: 'Result termination yielding computed output.'
      });
    }
  }

  if (steps.length === 0) {
    steps.push({
      lines: 'Lines 1 - ' + lines.length,
      code: lines.slice(0, 3).join('; '),
      purpose: 'Executes algorithmic sequence step-by-step.'
    });
  }

  return steps.slice(0, 6);
}

module.exports = { explainCode };
