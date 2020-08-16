const origin = self.registration.scope;
const tsUrl = 'https://unpkg.com/typescript@3.9.7/';
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

importScripts(tsUrl + 'lib/typescriptServices.js');

let tsLibsPromise = null;
const compiled = {};


function main() {
  tsLibsPromise = loadTsLibs();
  registerFetchHandler();
}

async function loadTsLibs() {
  const tsLibs = {};
  await Promise.all(tsLibFilenames.map(async filename => {
    tsLibs[filename] = await (await fetch(tsUrl + 'lib/' + filename)).text();
  }));
  return tsLibs;
}

function registerFetchHandler() {
  addEventListener('fetch', event => {
    if (!event.request.url.startsWith(origin)) {
      return;
    }

    const jsUrl = event.request.url + '.js';
    if (jsUrl in compiled) {
      console.log('Already compiled: ' + jsUrl);
      event.respondWith(createJsResponse(compiled[jsUrl]));
      return;
    }

    const path = getFilePath(event.request.url);
    if (path.endsWith('.ts')) {
      event.respondWith((async () => {
        return createJsResponse(await compile(path));
      })());
      return;
    }
  });
}

function createJsResponse(js) {
  return new Response(js, {
    headers: {'content-type': 'application/javascript'},
  });
}

async function compile(mainPath) {
  console.log('Compiling: ' + mainPath);
  
  const sourceFiles = await fetchSourceTree(mainPath);
  console.log('Prefetched source files: ', sourceFiles);

  ts.sys = createMockSystem(sourceFiles, await tsLibsPromise);
  let program = ts.createProgram([mainPath], {
    noEmitOnError: true,
    noImplicitAny: true,
    experimentalDecorators: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
  });
  let emitResult = program.emit();

  if (emitResult.emitSkipped) {
    return emitResult.diagnostics.map(diagnostic => {
      let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      return `console.error(${JSON.stringify(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`)});`;
    }).join('\n');
  }
  console.log('Compiled output: ', compiled);
  // main.ts -> main.js
  const mainCompiledPath = mainPath.replace(/\.ts$/, '.js');
  const mainCompiled = compiled[`${origin}${mainCompiledPath}`];
  console.log(mainCompiledPath, mainCompiled);
  return mainCompiled;
}

async function fetchSourceTree(mainPath) {
  const sourceFiles = {};
  const pendingPaths = new Set([mainPath]);
  const pendingRequests = new Set();
  while (true) {
    for (const path of pendingPaths) {
      if (path in sourceFiles) {
        continue;
      }

      sourceFiles[path] = null;
      let request = (async () => {
        const url = `${origin}${path}`;
        console.log('Fetching source file: ', url);
        const source = await (await fetch(url)).text();
        sourceFiles[path] = source;
        for (const modulePath of getModulePaths(path, source)) {
          pendingPaths.add(modulePath);
        }
        pendingRequests.delete(request);
      })();
      pendingRequests.add(request);
    }
    pendingPaths.clear();

    if (pendingRequests.size == 0) {
      break;
    }
    await Promise.race(pendingRequests);
  }
  return sourceFiles;
}

function* getModulePaths(path, source) {
  const basePath = getBasePath(path);
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext);
  for (const statement of sourceFile.statements) {
    if (!ts.isAnyImportOrReExport(statement)) {
      continue;
    }
    const modulePathExpr = ts.getExternalModuleName(statement);
    if (modulePathExpr && ts.isStringLiteral(modulePathExpr) && modulePathExpr.text) {
      const modulePath = appendPath(basePath, modulePathExpr.text);
      if (/\.js(\?.*)?$/.test(modulePath)) {
        // a/b/c.js?module
        yield modulePath;
      } else {
        // a/b/c
        yield modulePath + '.ts';
      }
    }
  }
}

function getBasePath(path) {
  // a/b/c -> a/b/
  return path.replace(/[^\/]*$/, '');
}

function appendPath(basePath, relativePath) {
  // a/b/c/, ../d/e -> a/b/d/e
  return new URL('https://test.com/' + basePath + relativePath).pathname.substring(1);
}

function getFilePath(url) {
  // https://witty-legend-velociraptor.glitch.me/main.ts -> main.ts
  return new URL(url).pathname.substring(1);
}

function createMockSystem(sourceFiles, tsLibs) {
  return {
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
      return path in tsLibs || path in sourceFiles;
    },
    readFile(path) {
      if (path in tsLibs) {
        return tsLibs[path];
      }
      if (path in sourceFiles) {
        return sourceFiles[path];
      }
      console.log('Missing file: ' + path)
    },
    writeFile(path, text) {
      compiled[`${origin}${path}`] = text;
    },
  };
}

main();
