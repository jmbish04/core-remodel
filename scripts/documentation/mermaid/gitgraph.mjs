#!/usr/bin/env node
/**
 * GitGraph Diagram Generator
 * ===========================
 *
 * Runs git log to extract the recent commit history, parses it, and translates
 * it into strict Mermaid gitGraph syntax. Auto-validates output before writing.
 *
 * Usage:
 *   node gitgraph.mjs [options]
 *
 * Options:
 *   --commits <num>   Number of commits to include (default: 15)
 *   --output <path>   Output markdown file path
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Reserved/problematic branch names that need quoting
const KEYWORDS = new Set(['main', 'master', 'develop', 'checkout', 'branch', 'commit', 'merge', 'cherry-pick']);

function sanitizeBranchName(name) {
  const clean = name.trim().replace(/['"`]/g, '');
  return KEYWORDS.has(clean) || clean.includes('-') || clean.includes('/') ? `"${clean}"` : clean;
}

function getGitHistory(limit) {
  // Format: short_hash | short_parents | decorations | subject
  // e.g. 2a3b4c | 1a2b3c 4a5b6c | (HEAD -> main, tag: v1.0.0) | initial commit
  try {
    // Array args (no shell) — limit is passed literally, no injection.
    const stdout = execFileSync(
      'git',
      ['log', '--format=%h|%p|%d|%s', '--topo-order', '-n', String(limit)],
      { encoding: 'utf8' }
    );
    return stdout.trim().split('\n').filter(Boolean);
  } catch (err) {
    console.error(`❌ Failed to read git history: ${err.message}`);
    process.exit(1);
  }
}

function parseDecorations(decorationsStr) {
  if (!decorationsStr) return { branches: [], tag: null };
  // Remove wrapping parens
  const clean = decorationsStr.trim().replace(/^\((.*)\)$/, '$1');
  const parts = clean.split(',').map(p => p.trim());
  const branches = [];
  let tag = null;

  for (const part of parts) {
    if (part.startsWith('tag: ')) {
      tag = part.replace('tag: ', '');
    } else if (part.includes('->')) {
      // e.g. HEAD -> main
      const branchName = part.split('->')[1].trim();
      if (branchName !== 'HEAD') {
        branches.push(branchName);
      }
    } else if (part && !part.startsWith('origin/') && part !== 'HEAD') {
      branches.push(part);
    }
  }

  return { branches, tag };
}

function generateGitGraph(commitsData) {
  const lines = ['gitGraph'];
  const declaredBranches = new Set(['main']);
  let currentBranch = 'main';

  // We want to reconstruct chronologically (oldest to newest)
  const commits = commitsData.map(line => {
    const [hash, parentsStr, decorationsStr, subject] = line.split('|');
    const parents = parentsStr ? parentsStr.trim().split(/\s+/) : [];
    const { branches, tag } = parseDecorations(decorationsStr);
    return {
      hash,
      parents,
      branches,
      tag,
      subject: subject ? subject.replace(/"/g, "'") : ''
    };
  }).reverse();

  // Map each commit hash to the branch it belongs to
  const commitBranchMap = new Map();

  for (const commit of commits) {
    let branchForCommit = 'main';

    if (commit.parents.length > 0) {
      // Connect to parent branch
      const parentHash = commit.parents[0];
      if (commitBranchMap.has(parentHash)) {
        branchForCommit = commitBranchMap.get(parentHash);
      }
    }

    // If decorations specify branches we haven't declared yet, create them
    for (const b of commit.branches) {
      if (!declaredBranches.has(b)) {
        // Checkout the parent branch first
        if (currentBranch !== branchForCommit) {
          lines.push(`    checkout ${sanitizeBranchName(branchForCommit)}`);
          currentBranch = branchForCommit;
        }
        lines.push(`    branch ${sanitizeBranchName(b)}`);
        declaredBranches.add(b);
        currentBranch = b;
        branchForCommit = b;
      }
    }

    // Switch branch if needed
    if (currentBranch !== branchForCommit) {
      lines.push(`    checkout ${sanitizeBranchName(branchForCommit)}`);
      currentBranch = branchForCommit;
    }

    commitBranchMap.set(commit.hash, branchForCommit);

    const tagStr = commit.tag ? ` tag: "${commit.tag}"` : '';

    if (commit.parents.length > 1) {
      // Merge commit
      const mergeParentHash = commit.parents[1];
      const mergeFromBranch = commitBranchMap.get(mergeParentHash) || 'main';
      
      // Customize merge styling using HIGHLIGHT type
      lines.push(`    merge ${sanitizeBranchName(mergeFromBranch)} id: "${commit.hash}"${tagStr} type: HIGHLIGHT`);
    } else {
      // Standard commit
      lines.push(`    commit id: "${commit.hash}"${tagStr}`);
    }
  }

  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  let limit = 15;
  let outputPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--commits') {
      limit = parseInt(args[++i], 10);
    } else if (args[i] === '--output') {
      outputPath = args[++i];
    }
  }

  const rawHistory = getGitHistory(limit);
  if (rawHistory.length === 0) {
    console.error('❌ No commit history found.');
    process.exit(1);
  }

  const gitGraphStr = generateGitGraph(rawHistory);
  const mdContent = `\`\`\`mermaid\n${gitGraphStr}\n\`\`\`\n`;

  if (!outputPath) {
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '_').slice(0, 15);
    outputPath = path.join(outputDir, `${timestamp}_gitgraph.md`);
  }

  fs.writeFileSync(outputPath, mdContent);

  const validatorPath = path.join(__dirname, 'validate.mjs');
  try {
    // Array args (no shell) — avoids injection via outputPath.
    execFileSync('node', [validatorPath, outputPath], { stdio: 'inherit' });
    console.error(`✅ GitGraph generated and validated: ${outputPath}`);
  } catch (err) {
    console.error(`❌ Validation failed for the GitGraph.`);
    process.exit(1);
  }
}

main();
