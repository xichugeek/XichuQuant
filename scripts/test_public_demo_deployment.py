"""Check the target configuration without starting Docker or contacting a server."""
import json
import secrets
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "deploy/linux/public-demo.env.example"


class PublicDemoDeploymentTests(unittest.TestCase):
    def fixture(self):
        values = dict(line.split("=", 1) for line in EXAMPLE.read_text().splitlines() if line and not line.startswith("#"))
        for key in ("MSSQL_SA_PASSWORD", "SEED_ADMIN_PASSWORD", "JWT_SECRET", "BROKER_ACCOUNT_HASH_PEPPER"):
            values[key] = "Synthetic-" + secrets.token_hex(16) + "!"
        values["DATABASE_URL"] = values["DATABASE_URL"].replace("INVALID_EXAMPLE_REPLACE_LOCALLY", values["MSSQL_SA_PASSWORD"])
        return values

    def validate(self, values):
        private = ROOT / "output/public-demo-environment-tests"
        private.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=private) as directory:
            env_file = Path(directory) / "test.env"
            env_file.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
            env_file.chmod(0o600)
            return subprocess.run(["node", "deploy/linux/check-environment.mjs", str(env_file), "--public-demo"], cwd=ROOT, capture_output=True).returncode

    def test_protected_fictional_environment_passes(self):
        self.assertEqual(self.validate(self.fixture()), 0)

    def test_example_cannot_initialize_a_real_runtime(self):
        values = dict(line.split("=", 1) for line in EXAMPLE.read_text().splitlines() if line and not line.startswith("#"))
        self.assertNotEqual(self.validate(values), 0)

    def test_readonly_https_and_demo_required(self):
        for patch in ({"PUBLIC_DEMO_READ_ONLY": "false"}, {"REQUIRE_HTTPS": "false"}, {"XICHURISK_DATA_MODE": "HISTORICAL"}, {"WEB_ORIGIN": "http://example.test"}):
            with self.subTest(patch=patch):
                self.assertNotEqual(self.validate({**self.fixture(), **patch}), 0)

    def test_external_configuration_is_rejected(self):
        for key in ("IBKR_PAPER_ACCOUNT_ID", "IBKR_PAPER_BASE_URL", "MARKET_DATA_HTTP_BASE_URL", "MARKET_DATA_HTTP_API_KEY", "FRED_API_KEY"):
            with self.subTest(key=key):
                self.assertNotEqual(self.validate({**self.fixture(), key: "synthetic-external-setting"}), 0)

    def test_proxy_trust_requires_exact_addresses(self):
        for value in ("true", "*", "0.0.0.0", "192.0.2.0/24"):
            with self.subTest(value=value):
                self.assertNotEqual(self.validate({**self.fixture(), "CADDY_TRUSTED_PROXY_IP": value}), 0)

    def test_static_addresses_must_be_distinct_and_inside_private_subnet(self):
        for patch in ({"PUBLIC_DEMO_WEB_IP": "172.30.88.10"}, {"PUBLIC_DEMO_WEB_IP": "172.30.89.20"}, {"PUBLIC_DEMO_WEB_IP": "172.30.88.1"}, {"PUBLIC_DEMO_FRONTEND_SUBNET": "192.0.2.0/24"}, {"PUBLIC_DEMO_FRONTEND_SUBNET": "172.30.88.1/24"}):
            with self.subTest(patch=patch):
                self.assertNotEqual(self.validate({**self.fixture(), **patch}), 0)

    def test_session_cap_and_ttl_are_bounded(self):
        for patch in ({"PUBLIC_DEMO_MAX_SESSIONS": "501"}, {"PUBLIC_DEMO_MAX_SESSIONS": "1"}, {"SESSION_TTL_HOURS": "0"}, {"SESSION_TTL_HOURS": "5"}):
            with self.subTest(patch=patch):
                self.assertNotEqual(self.validate({**self.fixture(), **patch}), 0)

    def test_compose_has_private_ports_networks_and_resource_budget(self):
        output = subprocess.check_output(["docker", "compose", "--env-file", str(EXAMPLE), "-f", "docker-compose.yml", "-f", "docker-compose.demo.yml", "-f", "docker-compose.public-demo.yml", "config", "--format", "json"], cwd=ROOT)
        config = json.loads(output)
        runtime = {name: service for name, service in config["services"].items() if "tools" not in service.get("profiles", [])}
        self.assertEqual(len(runtime), 6)
        self.assertEqual(sum(int(service["mem_limit"]) for service in runtime.values()), int(3.625 * 1024**3))
        self.assertEqual(sum(float(service["cpus"]) for service in runtime.values()), 4)
        self.assertTrue(all(not service.get("ports") and service.get("pids_limit") for service in runtime.values()))
        self.assertTrue(config["networks"]["backend"]["internal"])
        self.assertTrue(config["networks"]["frontend"]["internal"])
        self.assertTrue(config["networks"]["edge"]["external"])
        self.assertEqual([name for name, service in runtime.items() if "edge" in service["networks"]], ["reverse-proxy"])
        api = runtime["api"]["environment"]
        self.assertEqual(api["TRUSTED_PROXY_IPS"], "172.30.88.10,172.30.88.20")
        self.assertEqual(api["PUBLIC_DEMO_READ_ONLY"], "true")
        self.assertEqual(api["BROKER_CONNECTOR_MODE"], "OFFLINE")
        self.assertEqual(api["BROKER_CONNECTOR_ENVIRONMENT"], "DISABLED")
        self.assertTrue(runtime["reverse-proxy"]["read_only"])


if __name__ == "__main__":
    unittest.main()
