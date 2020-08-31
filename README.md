# typescript-service-worker
A service worker utility that translates *.ts files into *.js files with compile time checks enabled

In your service worker:  
```javascript
importScripts('https://randfur.github.io/typescript-service-worker/sw-ts-compiler.js');

const tsCompiler = new TsCompiler();

addEventListener('fetch', event => tsCompiler.handleFetch(event));
```

In your HTML:
```html
<script type="module" src="main.ts"></script>
```

In your main.ts:
```typescript
// .ts extension omitted (as required by TypeScript).
import {A} from 'some/local/ts/module';

// Must have some/local/js/module.d.ts present for .js files.
import {B} from 'some/local/js/module.js';

// External imports work too (needs library.d.ts file as well because .js file).
import {C} from 'https://unpkg.com/some/external/js/library.js';

// Type syntax works.
const x: number = 1 + 2;

// Imported types too.
const a: A = new A();

// Type mismatches fail compile, errors thrown in the console.
// Console error: main.ts (17,7): Property 'b' is missing in type 'C' but required in type 'B'.
const b: B = new C();
```
