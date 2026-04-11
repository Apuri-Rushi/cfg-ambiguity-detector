// Setup global tooltip for D3
const tooltip = d3.select("body").append("div")
    .attr("class", "d3-tooltip")
    .style("opacity", 0);

// --- Global State for Animation ---
let currentParseTrees = [];
let isAnimating = false;

// --- 1. Grammar Parsing Logic ---
function parseGrammar(rawText) {
    const rules = {};
    let startSymbol = null;
    const lines = rawText.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parts = trimmed.split('->');
        if (parts.length !== 2) continue;

        const lhs = parts[0].trim();
        if (!startSymbol) startSymbol = lhs;

        const rhsList = parts[1].split('|').map(s =>
            s.trim().split(/\s+/).filter(token => token.length > 0)
        );

        if (!rules[lhs]) rules[lhs] = [];
        rules[lhs].push(...rhsList);
    }
    return { rules, startSymbol };
}

// --- 2. Tree Generation Logic (Optimized + Fixed for Nesting) ---
function generateTrees(grammarInfo, tokens) {
    const { rules, startSymbol } = grammarInfo;
    const MAX_DEPTH = 12;

    const validParseTrees = [];
    const seenTrees = new Set();
    const memo = {};

    function match(symbol, start, end, depth) {
        if (validParseTrees.length >= 2) return [];
        if (depth > MAX_DEPTH) return [];
        if (start === end) return [];

        const remainingInput = tokens.slice(start, end).join(" ");
        const memoKey = `${symbol}|${remainingInput}`;

        if (memo[memoKey] !== undefined) return memo[memoKey];

        if (!rules[symbol]) {
            if (start + 1 === end && tokens[start] === symbol) {
                return [{ name: symbol }];
            }
            return [];
        }

        const results = [];
        const productions = rules[symbol];

        for (const rhs of productions) {
            if (validParseTrees.length >= 2) break;

            const subTreesOptions = matchSequence(rhs, 0, start, end, depth + 1);

            for (const children of subTreesOptions) {
                if (validParseTrees.length >= 2) break;

                const node = { name: symbol, children };
                results.push(node);

                if (symbol === startSymbol && start === 0 && end === tokens.length) {
                    const treeString = JSON.stringify(node);
                    if (!seenTrees.has(treeString)) {
                        seenTrees.add(treeString);
                        validParseTrees.push(node);

                        if (validParseTrees.length >= 2) return results;
                    }
                }
            }
        }

        if (validParseTrees.length < 2) memo[memoKey] = results;
        return results;
    }

    function matchSequence(rhs, rhsIndex, start, end, depth) {
        if (validParseTrees.length >= 2) return [];

        if (rhsIndex === rhs.length) {
            return start === end ? [[]] : [];
        }

        const currentSymbol = rhs[rhsIndex];
        const symbolsLeft = rhs.length - rhsIndex;
        const availableTokens = end - start;

        if (symbolsLeft > availableTokens) return [];

        if (rhsIndex === rhs.length - 1) {
            const childNodes = match(currentSymbol, start, end, depth);
            return childNodes.map(c => [c]);
        }

        const results = [];
        const maxTokensToConsume = availableTokens - (symbolsLeft - 1);
        const maxI = start + maxTokensToConsume;

        for (let i = start + 1; i <= maxI; i++) {
            if (validParseTrees.length >= 2) break;

            const leftOptions = match(currentSymbol, start, i, depth);

            if (leftOptions.length > 0) {
                const rightOptions = matchSequence(rhs, rhsIndex + 1, i, end, depth);
                for (const L of leftOptions) {
                    for (const R of rightOptions) {
                        if (validParseTrees.length >= 2) break;
                        results.push([L, ...R]);
                    }
                }
            }
        }
        return results;
    }

    match(startSymbol, 0, tokens.length, 0);
    return validParseTrees;
}

// --- 3. D3.js Visualization Logic (With Step-by-Step Play) ---
function renderTreeWithD3(treeDataArray, isPlaying = false) {
    const container = document.getElementById('tree-container');
    container.innerHTML = '';

    if (!treeDataArray || treeDataArray.length === 0) return 0;

    // Base animation parameters
    const duration = isPlaying ? 500 : 400; // Slower node animation when playing
    const levelDelay = isPlaying ? 500 : 150; // Delay between tree levels
    let maxDepthGlobal = 0;

    treeDataArray.forEach((treeData, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = "glass-card p-4 rounded-2xl flex justify-center items-center relative overflow-visible mt-4 tree-card";
        container.appendChild(wrapper);

        const width = 320;
        const height = 360;
        const margin = { top: 40, right: 30, bottom: 40, left: 30 };

        const svg = d3.select(wrapper).append("svg")
            .attr("width", width)
            .attr("height", height)
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        const root = d3.hierarchy(treeData);

        const treeLayout = d3.tree().size([
            width - margin.left - margin.right,
            height - margin.top - margin.bottom
        ]);

        treeLayout(root);

        // Find max depth to calculate total animation time
        const maxDepth = d3.max(root.descendants(), d => d.depth);
        if (maxDepth > maxDepthGlobal) maxDepthGlobal = maxDepth;

        // Render Edges
        svg.selectAll(".link")
            .data(root.links())
            .enter().append("path")
            .attr("class", "link")
            .attr("fill", "none")
            .attr("stroke", "#94a3b8")
            .attr("stroke-width", 2)
            .attr("d", d => {
                const parentPos = { x: d.source.x, y: d.source.y };
                return d3.linkVertical().x(p => p.x).y(p => p.y)({ source: parentPos, target: parentPos });
            })
            .transition()
            .duration(duration)
            .ease(d3.easeCubicOut)
            // Stagger based on PARENT depth
            .delay(d => d.source.depth * levelDelay)
            .attr("d", d3.linkVertical().x(d => d.x).y(d => d.y));

        // Render Nodes
        const node = svg.selectAll(".node")
            .data(root.descendants())
            .enter().append("g")
            .attr("class", "node cursor-pointer")
            .attr("transform", d => `translate(${d.parent ? d.parent.x : d.x},${d.parent ? d.parent.y : d.y}) scale(0.8)`)
            .attr("opacity", 0);

        // Hover Interactions
        node.on("mouseover", function (event, d) {
            d3.select(this).select("circle")
                .transition().duration(200)
                .attr("transform", "scale(1.15)")
                .attr("stroke", "#fff");

            tooltip.transition().duration(200)
                .style("opacity", 1)
                .style("transform", "translateY(0)");

            tooltip.html(d.children
                ? `<span class="text-sky-400 font-bold">Non-terminal:</span> ${d.data.name}`
                : `<span class="text-green-400 font-bold">Terminal:</span> ${d.data.name}`
            )
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 20) + "px");
        })
            .on("mouseout", function () {
                d3.select(this).select("circle")
                    .transition().duration(200)
                    .attr("transform", "scale(1)")
                    .attr("stroke", "rgba(255,255,255,0.2)");

                tooltip.transition().duration(200)
                    .style("opacity", 0)
                    .style("transform", "translateY(10px)");
            });

        // Animate Nodes in
        node.transition()
            .duration(duration)
            .ease(d3.easeBackOut.overshoot(1.5))
            // Stagger based on NODE depth
            .delay(d => d.depth * levelDelay)
            .attr("transform", d => `translate(${d.x},${d.y}) scale(1)`)
            .attr("opacity", 1);

        node.append("circle")
            .attr("r", 18)
            .attr("fill", d => {
                if (d.children) return "#38bdf8";
                if (["+", "*", "-", "/"].includes(d.data.name)) return "#7dd3fc";
                return "#22c55e";
            })
            .attr("stroke", "rgba(255,255,255,0.2)")
            .attr("stroke-width", 2)
            .style("backdrop-filter", "blur(4px)");

        node.append("text")
            .attr("dy", "0.35em")
            .attr("text-anchor", "middle")
            .attr("class", "text-sm font-extrabold fill-white pointer-events-none drop-shadow-md")
            .text(d => d.data.name);

        d3.select(wrapper).append("div")
            .attr("class", "absolute top-3 left-4 text-[10px] font-bold text-slate-400/50 uppercase tracking-widest")
            .text(`Derivation ${index + 1}`);
    });

    // Return the total animation time
    return (maxDepthGlobal * levelDelay) + duration;
}

// --- Trigger Step-by-Step Play ---
function playDerivation() {
    if (isAnimating || currentParseTrees.length === 0) return;

    isAnimating = true;
    const playBtn = document.getElementById('play-btn');
    playBtn.disabled = true;
    playBtn.innerHTML = `<span class="animate-pulse">⏳ Playing derivation...</span>`;

    // Re-render the tree with step-by-step delays active
    const totalTime = renderTreeWithD3(currentParseTrees, true);

    // Reset UX after animation completes
    setTimeout(() => {
        isAnimating = false;
        playBtn.disabled = false;
        playBtn.innerHTML = `<span>▶ Play Derivation</span>`;
    }, totalTime + 200);
}

// --- 4. Main Execution Pipeline (With Loading States) ---
function runAnalysis() {
    const grammarInput = document.getElementById('grammar-input').value;
    const stringInput = document.getElementById('string-input').value;
    const badge = document.getElementById('result-badge');
    const container = document.getElementById('tree-container');
    const playBtn = document.getElementById('play-btn');
    const fixBtn = document.getElementById('fix-ambiguity-btn');
    const suggestionBox = document.getElementById('suggestion-box');

    const grammarInfo = parseGrammar(grammarInput);
    const tokens = stringInput.trim().split(/\s+/).filter(x => x);

    badge.className = "px-4 py-2 rounded-lg font-bold text-sm bg-slate-800 border border-slate-700 transition-all duration-300";
    playBtn.style.display = "none"; // Hide play button while processing
    if (fixBtn) fixBtn.style.display = "none"; // Hide fix button at start
    if (suggestionBox) {
        suggestionBox.classList.add('hidden', 'opacity-0', 'scale-95');
        suggestionBox.classList.remove('opacity-100', 'scale-100');
    }

    if (tokens.length === 0 || !grammarInfo.startSymbol) {
        badge.classList.add("text-yellow-400", "glow-yellow");
        badge.innerHTML = "⚠️ Invalid Input Format";
        return;
    }

    container.innerHTML = `
        <div class="flex flex-col items-center justify-center space-y-4 opacity-0 transition-opacity duration-300" id="loading-state">
            <div class="w-10 h-10 border-4 border-sky-400 border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(56,189,248,0.5)]"></div>
            <p class="text-sky-400 font-medium tracking-wide drop-shadow-md">Constructing Syntax Trees...</p>
        </div>
    `;
    requestAnimationFrame(() => document.getElementById('loading-state').style.opacity = '1');

    setTimeout(() => {
        const uniqueTrees = generateTrees(grammarInfo, tokens);
        currentParseTrees = uniqueTrees; // Store globally for the play button

        if (uniqueTrees.length === 0) {
            badge.className = "px-4 py-2 rounded-lg font-bold text-sm bg-red-500/10 text-red-400 border border-red-500/30 glow-yellow";
            badge.innerHTML = "INVALID STRING ⚠️";
            container.innerHTML = `
                <div class="flex flex-col items-center text-red-400/80 p-8 glass-card rounded-2xl">
                    <span class="text-4xl mb-3">🚫</span>
                    <p class="font-medium">String cannot be derived from this grammar.</p>
                </div>`;
        }
        else if (uniqueTrees.length === 1) {
            badge.className = "px-4 py-2 rounded-lg font-bold text-sm bg-green-500/20 text-green-300 border border-green-500/50 glow-green";
            badge.innerHTML = "UNAMBIGUOUS ✅";
            playBtn.style.display = "flex"; // Show play button
            renderTreeWithD3(uniqueTrees);
        }
        else {
            badge.className = "px-4 py-2 rounded-lg font-bold text-sm bg-red-500/20 text-red-300 border border-red-500/50 glow-red";
            badge.innerHTML = `AMBIGUOUS ❌ <span class="ml-2 bg-red-500/30 px-2 py-0.5 rounded-full text-xs">${uniqueTrees.length} Trees</span>`;
            playBtn.style.display = "flex"; // Show play button
            if (fixBtn) fixBtn.style.display = "block"; // Show fix ambiguity button
            renderTreeWithD3(uniqueTrees);
        }
    }, 400); // 400ms delay to let the loading state be perceived
}

// --- 5. Fix Ambiguity Feature ---
function fixAmbiguity() {
    const grammarInput = document.getElementById('grammar-input').value;
    const suggestionBox = document.getElementById('suggestion-box');
    const suggestionContent = document.getElementById('suggestion-content');

    // Normalize string for simpler matching (remove all spaces)
    const normalized = grammarInput.replace(/\s+/g, '');

    let isPatternMatched = false;
    let suggestionHTML = '';

    // Pattern Detection for E -> E + E | E * E
    if (normalized.includes('E+E') && normalized.includes('E*E')) {
        isPatternMatched = true;
        suggestionHTML = `
            <div class="bg-slate-900/80 p-4 rounded-xl border border-slate-700 font-mono text-sky-300 leading-relaxed shadow-inner">
                E -> E + T | T<br>
                T -> T * F | F<br>
                F -> ( E ) | id
            </div>
            <p class="text-slate-400 mt-3 text-sm leading-relaxed p-1">
                This resolves ambiguity by enforcing operator precedence and associativity.
            </p>
            <button onclick="useAndVerify()" 
                class="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold py-2.5 px-4 rounded-xl shadow-[0_0_15px_rgba(34,197,94,0.3)] hover:shadow-[0_0_25px_rgba(34,197,94,0.5)] transform transition-all active:scale-95 focus:outline-none mt-4 flex items-center justify-center gap-2">
                <span>🔄</span> Use & Verify
            </button>
        `;
    }

    if (isPatternMatched) {
        suggestionContent.innerHTML = suggestionHTML;
    } else {
        suggestionContent.innerHTML = `
            <p class="text-yellow-400/90 italic bg-yellow-500/10 p-3 rounded-xl border border-yellow-500/20 shadow-inner">
                This system currently supports ambiguity fixing for common expression grammars only.
            </p>
        `;
    }

    if (suggestionBox) {
        suggestionBox.classList.remove('hidden');
        // Force reflow to enable transition from hidden state
        void suggestionBox.offsetWidth;
        suggestionBox.classList.remove('opacity-0', 'scale-95');
        suggestionBox.classList.add('opacity-100', 'scale-100');
    }
}

// --- 6. Use & Verify Workflow ---
function useAndVerify() {
    const grammarInput = document.getElementById('grammar-input');

    // Replace grammar with unambiguous version
    grammarInput.value = "E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id";

    // Run the analysis
    runAnalysis();

    // Smooth UX Enhancement: Override the loading text
    const loadingState = document.getElementById('loading-state');
    if (loadingState) {
        const textElement = loadingState.querySelector('p');
        if (textElement) {
            textElement.textContent = "Verifying suggested grammar...";
        }
    }

    // Smooth scroll to the visualization section
    const container = document.getElementById('tree-container');
    if (container) {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}