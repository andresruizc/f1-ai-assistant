"""Unit tests for tool schemas and format."""

import pytest
from src.tools import TOOL_SCHEMAS


class TestToolSchemas:
    """Tests for tool schema definitions."""

    def test_all_schemas_have_required_fields(self):
        """Every tool schema must have type, function.name, function.description, function.parameters."""
        for schema in TOOL_SCHEMAS:
            assert schema["type"] == "function"
            func = schema["function"]
            assert "name" in func
            assert "description" in func
            assert "parameters" in func
            assert len(func["description"]) > 20, f"Tool {func['name']} has a too-short description"

    def test_exactly_ten_tools(self):
        """PROJECT.md specifies 10 tools."""
        assert len(TOOL_SCHEMAS) == 10

    def test_tool_names_are_unique(self):
        """Tool names must be unique."""
        names = [s["function"]["name"] for s in TOOL_SCHEMAS]
        assert len(names) == len(set(names))

    def test_expected_tools_exist(self):
        """Verify all expected tool names are present."""
        expected = {
            "get_race_standings",
            "get_driver_info",
            "get_lap_times",
            "get_pit_stop_history",
            "get_tyre_strategy",
            "get_gap_between_drivers",
            "get_track_status",
            "get_weather_conditions",
            "get_race_summary",
            "compare_drivers",
        }
        actual = {s["function"]["name"] for s in TOOL_SCHEMAS}
        assert actual == expected
