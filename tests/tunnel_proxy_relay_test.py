import asyncio
import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location(
    "tunnel_proxy_relay", Path(__file__).parents[1] / "tools/tunnel-proxy-relay.py"
)
relay_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay_module)


class TunnelProxyRelayTest(unittest.IsolatedAsyncioTestCase):
    async def run_relay(self, proxy_handler, exchange):
        connections = set()

        async def track(handler, reader, writer):
            task = asyncio.current_task()
            connections.add(task)
            try:
                await handler(reader, writer)
            finally:
                writer.close()
                await writer.wait_closed()
                connections.discard(task)

        proxy = await asyncio.start_server(
            lambda r, w: track(proxy_handler, r, w), "127.0.0.1", 0
        )
        proxy_port = proxy.sockets[0].getsockname()[1]

        async def handler(reader, writer):
            await relay_module.relay(
                reader, writer, "region1.v2.argotunnel.com:7844", "127.0.0.1", proxy_port
            )

        server = await asyncio.start_server(
            lambda r, w: track(handler, r, w), "127.0.0.1", 0
        )
        try:
            await exchange(server.sockets[0].getsockname()[1])
        finally:
            server.close()
            proxy.close()
            await server.wait_closed()
            await proxy.wait_closed()
            for task in list(connections):
                task.cancel()
            await asyncio.gather(*connections, return_exceptions=True)

    async def test_preserves_binary_stream_and_reconnects(self):
        requests = []
        payload = bytes(range(256)) * 1024

        async def proxy(reader, writer):
            requests.append(await reader.readuntil(b"\r\n\r\n"))
            # Include tunneled bytes in the same write as the CONNECT response.
            writer.write(b"HTTP/1.1 200 Connection established\r\n\r\n\x16\x03\x03")
            await writer.drain()
            while data := await reader.read(65536):
                writer.write(data)
                await writer.drain()

        async def exchange(port):
            for _ in range(2):
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
                self.assertEqual(await asyncio.wait_for(reader.readexactly(3), 2), b"\x16\x03\x03")
                writer.write(payload)
                await writer.drain()
                self.assertEqual(await asyncio.wait_for(reader.readexactly(len(payload)), 2), payload)
                writer.close()
                await writer.wait_closed()

        await self.run_relay(proxy, exchange)
        self.assertEqual(len(requests), 2)
        self.assertTrue(all(r.startswith(b"CONNECT region1.v2.argotunnel.com:7844 HTTP/1.1\r\n") for r in requests))

    async def test_rejected_proxy_closes_client(self):
        async def proxy(reader, writer):
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
            await writer.drain()

        async def exchange(port):
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            self.assertEqual(await asyncio.wait_for(reader.read(), 2), b"")
            writer.close()
            await writer.wait_closed()

        await self.run_relay(proxy, exchange)


if __name__ == "__main__":
    unittest.main()
