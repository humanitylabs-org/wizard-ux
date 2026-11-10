# wizard-ux issue 1239: in-shell evidence

The real shell runs from web/ on a synthetic origin, and every write is refused. Phone (390x844) and desktop (1440x960),
Nebula and Grove. `defaults-*` = a fresh device. `stale-*` = a device that saved every removed switch as on, plus the
old two-orb layout. Script: look.cjs. Raw results are in */report.json.

- Running switches for defaults: the same on main and the branch in all 4 shell x skin cases (desktop-chats, unified-inbox).
- Settings › Look offers 23 switches on main and 16 on the branch. The 7 removed ids are gone.
- Stale device: on main all 7 removed packages load and the two-orb layout is worn. On the branch none of them is
  requested and the layout is classic. There are 0 page errors and 0 writes in all 16 runs.
- Pixel diff of the default screens, main vs branch: 0.003-0.99% on desktop and Nebula phone. On Grove phone Home it
  is 5.8%, from Grove's animated firefly background and the clock minute. The layout is the same.
