# Why Spilling to Disk Beats Pinning Everything in Memory

> Test fixture. Figures and named policies (LRU, read-through, write-behind) are illustrative
> examples written for testing `make-knowledge-cards`, not production benchmarks or vendor
> documentation.

A cache that tries to hold every object forever eventually dies. This note walks through why the
default instinct — keep hot data in RAM — breaks down, and what a production cache does instead.

## Memory is finite and you do not control the ceiling

A process on a typical node has somewhere between 2 and 16 GB of addressable heap. An object cache
of 500 byte entries costs roughly 1 KB per entry once pointers, hash-table buckets, and allocator
overhead are counted. That ceiling is the whole story: the machine decides when the cache stops,
not the application.

Eviction cannot be solved by monitoring alone. The moment an allocation spike crosses the limit, the
process is already in trouble; a dashboard showing memory usage is a post-mortem, not a control loop.

## The write path is where the cost hides

Eviction is cheap. Writing is not. Every miss that goes to the backing store pays a full network
round trip, and on a read-through cache that write happens on the request path, not in the
background.

This is why a cache that evicts too eagerly can end up slower than no cache at all: a 95% hit rate
on a 10 ms backing store still spends half a millisecond per request in serial round trips, while a
100% miss rate on a local disk read spends more but pipelines better.

## Per-tenant quotas beat global eviction

The failure mode that causes the most pages is not a traffic spike, it is one tenant. A single
customer uploading a video library can consume 60% of the cache, evict every other tenant, and drive
the hit rate to zero. Global LRU handles this badly because it has no notion of who caused the
pressure.

Per-tenant quotas fix it structurally: each key gets an eviction weight, and eviction runs within
the heaviest tenant first. The noisy neighbor is contained before it damages anyone else's hit rate.

## Write-behind and read-through are different products

Read-through hides latency from the caller at the cost of putting the write on the request path.
Write-behind moves the write off the request path at the cost of a window where the cache and the
store disagree. If the cache is the source of truth, read-through is the only correct choice. If
the store is, write-behind is safe as long as the window is bounded and acknowledged.

## What to measure

Three numbers decide whether eviction policy matters at all:

- Hit rate, per tenant, not global. A global hit rate hides the noisy neighbor perfectly.
- Evictions per second, separated into "evicted something older than 60 seconds" and the rest. A
  healthy cache evicts rarely.
- Misses that required a write. This isolates the read-through cost from the hit rate itself.

If write-misses are near zero, the cache is doing its job and eviction policy is a secondary
concern. If write-misses dominate, the problem is the backing store, not the cache.