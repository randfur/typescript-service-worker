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
import {A} from 'some/local/ts/module';
import {B} from 'some/local/js/module.js'; // Must have module.d.ts present.
import {C} from 'https://unpkg.com/some/external/js/library.js'; // Must have library.d.ts present.

const x: number = new A(B.invalidProperty + C.cannotAdd); // This will fail compile and show errors in the console.
```
