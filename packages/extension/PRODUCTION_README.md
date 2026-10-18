# Production Deployment Guide

## Build Commands

### Development Build
```bash
npm run build:dev
```
- Outputs to `.output/dev/`
- Includes source maps
- No minification
- Dev mode toggle visible

### Production Build
```bash
npm run build:prod
```
- Outputs to `.output/prod/`
- Minified JavaScript with Terser
- No source maps (security)
- Dev mode toggle hidden
- Optimized chunk splitting
- Content Security Policy enabled

### Bundle Analysis
```bash
npm run build:analyze
```
- Generates bundle size analysis
- Helps identify large dependencies

### Production Zip
```bash
npm run zip:prod
```
- Creates production-ready extension zip file

## Production Optimizations Applied

### Code Optimization
- ✅ JavaScript minification (Terser)
- ✅ CSS code splitting
- ✅ Manual chunk splitting for vendor libraries
- ✅ Tree shaking
- ✅ Source maps disabled in production

### Security
- ✅ Content Security Policy (CSP) headers
- ✅ Environment-specific configurations
- ✅ No development code in production builds

### Performance
- ✅ Error boundaries for graceful failure handling
- ✅ Performance monitoring utilities
- ✅ Compressed bundle size reporting
- ✅ Optimized asset loading

### Build Features
- ✅ Environment variable system (WXT native)
- ✅ Conditional feature flags (`__PRODUCTION__`, `__DEV__`)
- ✅ Automated bundle analysis
- ✅ Production error reporting hooks

## Bundle Size Breakdown

The production build optimizes bundle splitting:

- **react-vendor**: React core libraries
- **ui-vendor**: Radix UI components
- **ml-vendor**: ML libraries (@huggingface/transformers, @mlc-ai/web-llm)
- **document-vendor**: Document processing (PDF, Word)

## Environment Variables

Production builds automatically use:
- `WXT_ENVIRONMENT=PROD`
- `__PRODUCTION__=true`
- Optimized CSP policies

## Monitoring

Production builds include:
- Error boundary components
- Performance monitoring utilities
- Structured error reporting hooks
- Memory usage tracking (development only)

## Deployment Checklist

- [ ] Run `npm run build:prod`
- [ ] Test extension in Chrome
- [ ] Verify no console errors
- [ ] Check bundle size is reasonable
- [ ] Test error boundaries
- [ ] Run `npm run zip:prod` for store submission
- [ ] Update version numbers
- [ ] Tag release in git