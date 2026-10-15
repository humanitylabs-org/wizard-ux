# Scoped publisher metadata patches

Apply only these hunks to the existing live publisher files after the companion backend is verified. Preserve all neighboring work. Source snapshots and inventory stay local/ignored; bodies and report semantics are unchanged.

Topics `/home/telos/apps/topic-watchers/watch.py`:
```diff
-                                              display_metadata={'report_id': key, 'report_topic': TOPICS_TITLE})
+                                              display_metadata={'report_id': key, 'report_topic': TOPICS_TITLE, 'app_id': 'topics'})
```

Signal `/home/telos/apps/wizard-signal/signal_feedback_review.py`:
```diff
         display_metadata={
             'report_id': key,
+            'app_id': 'wizard-signal',
             'report_week': key.rsplit(':', 1)[-1],
```

Verification: `qa-app-publishers.py` executes these two actual isolated functions against a real disposable SessionDB. It verifies the stored metadata, unchanged body, Topics idempotency and Signal frozen/week metadata without a production write.
