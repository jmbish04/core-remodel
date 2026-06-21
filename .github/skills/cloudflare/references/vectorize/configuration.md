# Vectorize Configuration

## Create Index

```bash
# Standard 1536 dimension index accepting concatenated multi-modal BGE + Gemma embeddings
npx wrangler vectorize create remodel-embeddings --dimensions=1536 --metric=dotproduct
```

**⚠️ Dimensions and metric are immutable** - cannot change after creation.

### Dimensional Ceiling & Pooled Embeddings
To accommodate multi-perspective pooled spaces, vectors from distinct models (e.g. BGE 768d + Gemma 768d) are concatenated back-to-back into a unified 1536-dimensional float allocation.

### Search Metrics & Similarity
* Since vectors are **pre-normalized** to unit length inside the processing pipeline loop, **dotproduct** and **cosine** metrics yield mathematically identical similarity rankings. 
* Pre-normalization followed by `dotproduct` similarity is highly recommended for optimal performance on Vectorize.

### Float Allocation
* All array inputs to Vectorize must be explicitly mapped to standard single-precision floats. Convert any inputs to `Float32Array` or map them to guarantee standard `Float32` allocation before passing to `vectorIndex.upsert()` or `vectorIndex.query()`.


## Worker Binding

```jsonc
// wrangler.jsonc
{
  "vectorize": [
    { "binding": "VECTORIZE", "index_name": "my-index" }
  ]
}
```

```typescript
interface Env {
  VECTORIZE: Vectorize;
}
```

## Metadata Indexes

**Must create BEFORE inserting vectors** - existing vectors not retroactively indexed.

```bash
wrangler vectorize create-metadata-index my-index --property-name=category --type=string
wrangler vectorize create-metadata-index my-index --property-name=price --type=number
```

| Type | Use For |
|------|---------|
| `string` | Categories, tags (first 64 bytes indexed) |
| `number` | Prices, timestamps |
| `boolean` | Flags |

## CLI Commands

```bash
# Index management
wrangler vectorize list
wrangler vectorize info <index-name>
wrangler vectorize delete <index-name>

# Vector operations
wrangler vectorize insert <index-name> --file=embeddings.ndjson
wrangler vectorize get <index-name> --ids=id1,id2
wrangler vectorize delete-by-ids <index-name> --ids=id1,id2

# Metadata indexes
wrangler vectorize list-metadata-index <index-name>
wrangler vectorize delete-metadata-index <index-name> --property-name=field
```

## Bulk Upload (NDJSON)

```json
{"id": "1", "values": [0.1, 0.2, ...], "metadata": {"category": "docs"}}
{"id": "2", "values": [0.4, 0.5, ...], "namespace": "tenant-abc"}
```

**Limits:** 5000 vectors per file, 100 MB max

## Cardinality Best Practice

Bucket high-cardinality data:
```typescript
// ❌ Millisecond timestamps
metadata: { timestamp: Date.now() }

// ✅ 5-minute buckets
metadata: { timestamp_bucket: Math.floor(Date.now() / 300000) * 300000 }
```

## Production Checklist

1. Create index with correct dimensions
2. Create metadata indexes FIRST
3. Test bulk upload
4. Configure bindings
5. Deploy Worker
6. Verify queries
