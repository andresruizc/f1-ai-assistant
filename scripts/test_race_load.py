"""Verify FastF1 data loading works — run with: uv run python scripts/test_race_load.py"""

import fastf1

fastf1.Cache.enable_cache("data/.fastf1_cache")

print("Loading 2024 British GP...")
session = fastf1.get_session(2024, 12, "R")
session.load()

print(f"Event: {session.event['EventName']}")
print(f"Total laps: {session.laps['LapNumber'].max()}")
print(f"Drivers: {session.laps['Driver'].nunique()}")
print(f"Laps shape: {session.laps.shape}")
print(f"Weather samples: {len(session.weather_data)}")
print(f"Track status changes: {len(session.track_status)}")
print("\nFirst 5 drivers in results:")
for _, row in session.results.head(5).iterrows():
    print(f"  P{int(row['Position'])}: {row['Abbreviation']} ({row['TeamName']})")
print("\nDone! FastF1 is working correctly.")
