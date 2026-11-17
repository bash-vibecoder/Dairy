/* Pure editing helpers; used by the app and the Node regression tests. */
(function (root) {
  'use strict';
  const Core = {
    searchSpec(query, options) {
      if (!query) return null;
      let source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (options.wholeWord) source = '\\b(?:' + source + ')\\b';
      return new RegExp(source, 'gm' + (options.caseSensitive ? '' : 'i'));
    },
    findMatches(text, regex, limit = 20000) {
      if (!regex) return [];
      regex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
      const matches = [];
      let m;
      while ((m = regex.exec(text)) && matches.length < limit) {
        matches.push({from: m.index, to: m.index + m[0].length, value: m[0], groups: m.slice(1)});
        if (m[0].length === 0) regex.lastIndex++;
      }
      return matches;
    },
    replacement(match, replacement, regex) {
      if (!regex) return replacement;
      return replacement.replace(/\$(\$|&|[1-9][0-9]?)/g, (token, key) => {
        if (key === '$') return '$';
        if (key === '&') return match.value;
        const n = Number(key);
        if (n <= match.groups.length) return match.groups[n - 1] || '';
        if (key.length === 2 && Number(key[0]) <= match.groups.length) return (match.groups[Number(key[0]) - 1] || '') + key[1];
        return token;
      });
    },
    replaceAll(text, regex, replacement, regexMode) {
      const matches = Core.findMatches(text, regex, Number.MAX_SAFE_INTEGER);
      let result = '', last = 0;
      for (const m of matches) { result += text.slice(last, m.from) + Core.replacement(m, replacement, regexMode); last = m.to; }
      return {text: result + text.slice(last), count: matches.length};
    },
    sortLines(text, descending, unique, ignoreCase) {
      const trailing = text.endsWith('\n');
      let lines = (trailing ? text.slice(0, -1) : text).split('\n');
      if (unique) lines = [...new Set(lines)];
      lines.sort((a, b) => {
        const left = ignoreCase ? a.toLowerCase() : a, right = ignoreCase ? b.toLowerCase() : b;
        return left < right ? -1 : left > right ? 1 : 0;
      });
      if (descending) lines.reverse();
      return lines.join('\n') + (trailing ? '\n' : '');
    },
    normalize(text) { return text.replace(/\r\n?/g, '\n'); },
    detectLanguage(text) {
      const sample = text.slice(0,16000).trimStart();
      if (!sample) return 'text/plain';
      const first = sample.split('\n',1)[0];
      if (/^#!.*\b(?:python[23]?(?:\.\d+)?|pypy[23]?)\b/.test(first)) return 'text/x-python';
      if (/^#!.*\b(?:bash|sh|zsh|ksh|dash|fish)\b/.test(first)) return 'text/x-sh';
      if (/^#!.*\b(?:node|nodejs|deno|bun)\b/.test(first)) return 'text/javascript';
      if (/^#!.*\bruby\b/.test(first)) return 'text/x-ruby';
      if (/^#!.*\bperl\b/.test(first)) return 'text/x-perl';
      if (/^#!.*\blua\b/.test(first)) return 'text/x-lua';
      if (/<\?php\b/i.test(sample)) return 'application/x-httpd-php';
      if (/^(?:<!doctype\s+html\b|<html\b)|<(?:head|body|script|div|section|button|h[1-6])(?:\s|>)/i.test(sample)) return 'text/html';
      if (/^<\?xml\b/.test(sample) || /^<[\w:-]+(?:\s[^>]*)?>[\s\S]*<\/[\w:-]+>\s*$/.test(sample)) return 'application/xml';
      if (/^[\[{]/.test(sample)) {
        if (text.length <= 250000) { try { const value=JSON.parse(text);if(value&&typeof value==='object')return 'application/json'; } catch(e) {} }
        if (/^(?:\{\s*"[^"\n]+"\s*:|\[\s*\{\s*")/.test(sample)) return 'application/json';
      }
      const rules = [
        ['text/x-python',[/^(?:from\s+[\w.]+\s+import\s+|import\s+\w+\s*$)/m,/^\s*(?:async\s+)?def\s+\w+\([^\n]*\)\s*(?:->[^\n:]+)?\s*:/m,/^\s*(?:elif\s+.+|except(?:\s+.+)?|if\s+__name__\s*==.+)\s*:/m,/\bprint\s*\([^\n]*\)/]],
        ['text/x-sh',[/^\s*(?:if\s+\[|elif\s+\[|fi\s*$|esac\s*$|done\s*$)/m,/^\s*(?:export\s+\w+=|\w+=\$\()/m,/\$\{?[A-Za-z_]\w*\}?/,/^\s*(?:echo|printf|sudo|apt|su)\s+/m]],
        ['text/x-java',[/^\s*import\s+java[\w.]*;/m,/\bpublic\s+(?:final\s+|abstract\s+)?class\s+\w+/,/\b(?:public|private|protected)\s+(?:static\s+)?(?:void|String|int|boolean)\s+\w+\s*\(/,/\bSystem\.out\.print(?:ln)?\s*\(/]],
        ['text/x-kotlin',[/^\s*fun\s+\w+\s*\(/m,/\b(?:val|var)\s+\w+\s*:\s*(?:String|Int|Boolean)\b/,/^\s*import\s+kotlin\./m,/\bdata\s+class\s+\w+/]],
        ['text/x-c++src',[/^\s*#include\s*<(?:iostream|string|vector|map|memory)>/m,/\bstd::\w+/,/\b(?:cout|cin)\s*(?:<<|>>)/,/\btemplate\s*<[^>]+>/]],
        ['text/x-csrc',[/^\s*#include\s*[<"][\w/]+\.h[>"]/m,/\b(?:int|void)\s+main\s*\(/,/\b(?:printf|scanf|malloc|free)\s*\(/,/\btypedef\s+(?:struct|enum)\b/]],
        ['text/x-csharp',[/^\s*using\s+System(?:\.|;)/m,/\bConsole\.(?:WriteLine|ReadLine)\s*\(/,/^\s*namespace\s+\w+/m,/\b(?:public|private)\s+(?:static\s+)?(?:string|bool)\b/]],
        ['text/x-go',[/^package\s+\w+\s*$/m,/^func\s+(?:\([^\n]+\)\s*)?\w+\s*\(/m,/\bfmt\.(?:Println|Printf)\s*\(/,/\w+\s*:=\s*.+/]],
        ['text/x-rustsrc',[/^\s*(?:pub\s+)?fn\s+\w+\s*\(/m,/\b(?:println|vec|format)!\s*\(/,/\blet\s+mut\s+\w+/,/^\s*use\s+\w+::/m]],
        ['text/typescript',[/^\s*(?:export\s+)?(?:interface|type)\s+\w+\s*(?:[={])/m,/\b(?:const|let)\s+\w+\s*:\s*(?:string|number|boolean|[A-Z]\w*)/,/\([^\n)]*:\s*(?:string|number|boolean)\b/]],
        ['text/javascript',[/\b(?:const|let)\s+\w+\s*=/,/\bfunction\s+\w*\s*\(/,/=>\s*(?:\{|\w)/,/\b(?:console\.log|document\.(?:querySelector|getElementById)|require)\s*\(/,/^\s*(?:export\s+(?:default|const|function)|import\s+.+\s+from\s+['"])/m]],
        ['text/css',[/[.#][\w-]+(?:\s+[^\n{]+)?\s*\{/,/\b(?:color|background|padding|margin|font-size|display|border)\s*:\s*[^;{}\n]+[;}]/,/^\s*@(?:media|import|keyframes|font-face)\b/m]],
        ['text/x-sql',[/\bSELECT\s+[\s\S]+?\s+FROM\s+\w+/i,/\b(?:CREATE|ALTER|DROP)\s+TABLE\s+\w+/i,/\bINSERT\s+INTO\s+\w+/i,/\b(?:WHERE|JOIN|GROUP\s+BY|ORDER\s+BY)\s+\w+/i]],
        ['text/x-ruby',[/^\s*def\s+\w+(?:\([^\n]*\))?\s*$/m,/^\s*(?:puts|require|require_relative)\s+['"]/m,/^\s*end\s*$/m]],
        ['text/x-lua',[/^\s*local\s+\w+\s*=/m,/\bfunction\s+\w+\([^)]*\)/,/^\s*--\s+\S/m]],
        ['text/x-markdown',[/^#{1,6}\s+\S/m,/^```\w*\s*$/m,/!?\[[^\]]+\]\([^)]+\)/,/^\s*[-*+]\s+\S/m]],
        ['text/x-yaml',[/^---\s*$/m,/^[\w-]+:\s*(?:\S.*)?$/m,/^\s+-\s+[\w-]+:\s*/m,/^\s{2,}[\w-]+:\s*\S/m]],
        ['text/x-dockerfile',[/^FROM\s+\S+/m,/^(?:RUN|COPY|WORKDIR|ENTRYPOINT|CMD|EXPOSE)\s+\S+/m]],
        ['text/x-toml',[/^\[[\w.-]+\]\s*$/m,/^\w+\s*=\s*(?:["']|true\b|false\b|\d)/m]]
      ];
      let best='text/plain',score=0;
      for(const [mime,patterns] of rules){const count=patterns.reduce((n,re)=>n+(re.test(sample)?1:0),0);if(count>score&&count>=2){score=count;best=mime;}}
      if(best==='text/plain'){
        if(/^\s*(?:async\s+)?def\s+\w+\([^\n]*\)\s*:/m.test(sample))return 'text/x-python';
        if(/^\s*#include\s*</m.test(sample))return /iostream|std::/.test(sample)?'text/x-c++src':'text/x-csrc';
        if(/^FROM\s+[\w:./-]+/m.test(sample))return 'text/x-dockerfile';
      }
      return best;
    }
  };
  root.EditorCore = Core;
  if (typeof module !== 'undefined') module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
