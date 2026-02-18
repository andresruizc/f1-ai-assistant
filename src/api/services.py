"""Shared singletons — RaceService holds the loaded race state."""

from loguru import logger

from src.race_state import RaceState


class RaceService:
    """Singleton service that holds the loaded race state.

    FastF1 sessions are expensive to load (10-30s). This caches the
    loaded session in memory so the entire app shares one instance.
    """

    _instance: "RaceService | None" = None
    _race_state: RaceState | None = None

    @classmethod
    def get_instance(cls) -> "RaceService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def load_race(self, year: int, round_number: int) -> dict:
        """Load a race and cache the RaceState.

        Args:
            year: Season year.
            round_number: Round number within the season.

        Returns:
            Race metadata dict.
        """
        logger.info("Loading race: year={}, round={}", year, round_number)
        self._race_state = RaceState(year, round_number)
        return self._race_state.get_metadata()

    @property
    def race_state(self) -> RaceState:
        """Get the cached race state, or raise if none loaded."""
        if self._race_state is None:
            raise RuntimeError("No race loaded. Call POST /api/race/load first.")
        return self._race_state

    @property
    def is_loaded(self) -> bool:
        """Check whether a race is currently loaded."""
        return self._race_state is not None
