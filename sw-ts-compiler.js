const tsLibs = {};
let tsReady = null;

class TsCompiler {
  constructor({verbose}={verbose: 0}) {
    this.verbose = verbose;
    this.sourceFiles = {};
    this.compiledFiles = {};
  }
  
  handleFetch(event) {
    event.respondWith((async () => {
      const compile = await this.compileUrl(event.request.url);
      if (compile) {
        this.log(3, 'TsCompiler serving: ', event.request.url, compile);
        return new Response(compile, {
          headers: {'content-type': 'application/javascript'},
        });
      }
      return fetch(event.request);
    })());
  }
  
  async compileUrl(fetchUrl) {
    const isBrowserFetchingTs = fetchUrl.endsWith('.ts');
    if (isBrowserFetchingTs) {
      const changed = await this.downloadImports(fetchUrl);
      if (changed)
        return this.compileSourceFile(fetchUrl);
    }

    const compiled = this.compiledFiles[tsUrlToCompiledUrl(fetchUrl)];
    if (compiled) {
      this.log(1, 'Compile cache hit: ', fetchUrl);
      return compiled;
    }

    if (isBrowserFetchingTs)
      return this.compileSourceFile(fetchUrl);

    return null;
  }
  
  async downloadImports(rootUrl) {
    this.log(1, 'Downloading imports for: ', rootUrl);
    let changed = false;
    const pendingUrls = new Set([rootUrl]);
    const seenUrls = new Set();
    const downloads = new Map();

    while (true) {
      for (const url of pendingUrls) {
        this.log(3, 'Downloading: ', url);
        seenUrls.add(url);
        const download = (async () => {
          const response = await fetch(url);
          this.log(3, 'Downloaded: ', url);
          return {
            url,
            data: response.ok ? await response.text() : null,
          };
        })();
        downloads.set(url, download.finally(() => downloads.delete(url)));
      }
      pendingUrls.clear();

      if (downloads.size == 0)
        break;

      const {url, data} = await Promise.race(downloads.values());
      if (data == null) {
        this.log(1, 'Download failed: ', url);
        continue;
      }

      if (this.sourceFiles[url] != data) {
        this.log(2, 'Source changed: ', url)
        changed = true;
      }
      this.sourceFiles[url] = data;
      
      for (const importUrl of this.getModulePaths(url, data)) {
        if (!seenUrls.has(importUrl)) {
          this.log(3, 'New import: ', importUrl);
          pendingUrls.add(importUrl);
        }
      }
    }
    return changed;
  }

  *getModulePaths(url, source) {
    const sourceFile = ts.createSourceFile('', source, ts.ScriptTarget.ESNext);
    for (const statement of sourceFile.statements) {
      if (!ts.isAnyImportOrReExport(statement)) {
        continue;
      }
      const modulePathExpr = ts.getExternalModuleName(statement);
      if (modulePathExpr && ts.isStringLiteral(modulePathExpr) && modulePathExpr.text) {
        let sourceUrl = tsUrlToSourceUrl(modulePathExpr.text);
        if (sourceUrl.startsWith('.'))
          sourceUrl = new URL(url + '/../' + sourceUrl).href;
        yield sourceUrl;
      }
    }
  }
  
  compileSourceFile(url) {
    this.log(1, 'Compiling: ', url);
    
    const compiledUrl = tsUrlToCompiledUrl(url);
    delete this.compiledFiles[compiledUrl];

    const self = this;
    ts.sys = {
      useCaseSensitiveFileNames: true,
      newLine: '\n',
      getExecutingFilePath() {
        return '';
      },
      getCurrentDirectory() {
        return '';
      },
      directoryExists(dir) {
        return true;
      },
      getDirectories(dir) {
        return [];
      },
      fileExists(path) {
        return path in tsLibs || path in self.sourceFiles;
      },
      readFile(path) {
        if (path in tsLibs) {
          self.log(3, 'Read lib: ', path);
          return tsLibs[path];
        }
        if (path in self.sourceFiles) {
          self.log(3, 'Read source: ', path);
          return self.sourceFiles[path];
        }
        self.log(1, 'Missing file: ', path);
        return null;
      },
      writeFile(path, text) {
        self.log(2, 'Write file: ', path);
        self.compiledFiles[path] = text;
      },
    };

    let program = ts.createProgram([url], {
      noEmitOnError: true,
      noImplicitAny: true,
      experimentalDecorators: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    });
    let emitResult = program.emit();
    this.log(2, 'Compile result: ', emitResult);

    if (emitResult.emitSkipped) {
      return emitResult.diagnostics.map(diagnostic => {
        let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        return `console.error(${JSON.stringify(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`)});`;
      }).join('\n');
    }
    return this.compiledFiles[compiledUrl];
  }
  
  log(level, ...args) {
    if (level <= this.verbose)
      console.log(...args);
  }
}

function tsUrlToCompiledUrl(tsUrl) {
  // ./test -> ./test.js
  // ./test.ts -> ./test.js
  return tsUrl.replace(/\.ts$/, '') + '.js';
}

function tsUrlToSourceUrl(tsUrl) {
  // ./test -> ./test.ts
  // ./test.ts -> ./test.ts
  // ./test.js -> ./test.d.ts
  if (tsUrl.endsWith('.ts'))
    return tsUrl;
  if (tsUrl.endsWith('.js'))
    return tsUrl.replace(/\.js$/, '.d.ts');
  return tsUrl + '.ts';
}

tsReady = (async () => {
  const tsLibRoot = 'https://unpkg.com/typescript@4.0.2/';
  const tsLibFilenames = [
    'lib.d.ts',
    'lib.dom.d.ts',
    'lib.dom.iterable.d.ts',
    'lib.es2015.collection.d.ts',
    'lib.es2015.core.d.ts',
    'lib.es2015.d.ts',
    'lib.es2015.generator.d.ts',
    'lib.es2015.iterable.d.ts',
    'lib.es2015.promise.d.ts',
    'lib.es2015.proxy.d.ts',
    'lib.es2015.reflect.d.ts',
    'lib.es2015.symbol.d.ts',
    'lib.es2015.symbol.wellknown.d.ts',
    'lib.es2016.array.include.d.ts',
    'lib.es2016.d.ts',
    'lib.es2017.d.ts',
    'lib.es2017.intl.d.ts',
    'lib.es2017.object.d.ts',
    'lib.es2017.sharedmemory.d.ts',
    'lib.es2017.string.d.ts',
    'lib.es2017.typedarrays.d.ts',
    'lib.es2018.asyncgenerator.d.ts',
    'lib.es2018.asynciterable.d.ts',
    'lib.es2018.d.ts',
    'lib.es2018.intl.d.ts',
    'lib.es2018.promise.d.ts',
    'lib.es2018.regexp.d.ts',
    'lib.es2019.array.d.ts',
    'lib.es2019.d.ts',
    'lib.es2019.object.d.ts',
    'lib.es2019.string.d.ts',
    'lib.es2019.symbol.d.ts',
    'lib.es2020.bigint.d.ts',
    'lib.es2020.d.ts',
    'lib.es2020.intl.d.ts',
    'lib.es2020.promise.d.ts',
    'lib.es2020.string.d.ts',
    'lib.es2020.symbol.wellknown.d.ts',
    'lib.es5.d.ts',
    'lib.esnext.d.ts',
    'lib.esnext.full.d.ts',
    'lib.esnext.intl.d.ts',
    'lib.esnext.promise.d.ts',
    'lib.esnext.string.d.ts',
    'lib.scripthost.d.ts',
    'lib.webworker.importscripts.d.ts',
  ];
  const libsLoaded = Promise.all(tsLibFilenames.map(async filename => {
    tsLibs[filename] = await (await fetch(tsLibRoot + 'lib/' + filename)).text();
  }));
  importScripts(tsLibRoot + 'lib/typescriptServices.js');
  await libsLoaded;
})();
