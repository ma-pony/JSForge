# Handoff 阶段：Python 爬虫项目生成模板

> **阶段目标**：生成脱离浏览器运行的 Python 请求项目，并验证其业务结果与真实浏览器请求一致。

---

## 进入条件（Entry Gate）

**必须满足，否则不得进入本阶段：**

- [ ] 非浏览器客户端已成功获得预期业务响应
- [ ] 请求结果已与真实浏览器请求完成多样本对照
- [ ] 存在动态生成逻辑时，`crypto.py` 已通过 ≥3 组 fixture 验证
- [ ] 所需凭据、会话状态及其来源和刷新方式已明确

浏览器内 `fetch`、DOM 提取或由 Python 启动浏览器都不满足进入条件。浏览器只能用于采集样本和结果对照。

---

## 项目结构

```
{task_name}_crawler/
├── main.py           # 主爬虫逻辑：请求 + 加密 + 重试
├── crypto.py         # 可选：动态生成函数（来自 extraction 阶段）
├── config.py         # 配置：URL、请求头、加密参数
├── fixtures.json     # 可选：动态生成逻辑的验证样本
└── requirements.txt  # Python 依赖列表
```

---

## main.py 模板

```python
"""
{task_name} 爬虫
目标: {target_url}
生成时间: {date}
"""

import time
import json
import logging
from typing import Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import TARGET_URL, HEADERS, CRYPTO_CONFIG
from crypto import encrypt

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)


def build_session() -> requests.Session:
    """创建带重试策略的 requests Session"""
    session = requests.Session()

    # 重试策略：网络错误时自动重试，最多 3 次
    retry = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[500, 502, 503, 504],
        allowed_methods=["GET", "POST"]
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)

    # 设置请求头（复制自浏览器 Network 面板）
    session.headers.update(HEADERS)

    # 加载 Cookie（来自 save_session_state）
    _load_cookies(session)

    return session


def _load_cookies(session: requests.Session) -> None:
    """从 session_state.json 加载 cookies"""
    try:
        with open("session_state.json") as f:
            state = json.load(f)
        for cookie in state.get("cookies", []):
            session.cookies.set(
                cookie["name"],
                cookie["value"],
                domain=cookie.get("domain", ""),
                path=cookie.get("path", "/")
            )
        logger.info(f"已加载 {len(state.get('cookies', []))} 个 cookies")
    except FileNotFoundError:
        logger.warning("session_state.json 未找到，将以无 cookie 状态请求")


def fetch_page(session: requests.Session, page: int = 1, keyword: str = "") -> dict:
    """
    获取一页数据

    Args:
        session: requests Session
        page: 页码
        keyword: 搜索关键词

    Returns:
        解析后的 JSON 响应
    """
    # 构造加密参数
    timestamp = int(time.time() * 1000)
    raw_data = f"keyword={keyword}&page={page}&timestamp={timestamp}"
    sign = encrypt(
        data=raw_data,
        key=CRYPTO_CONFIG["key"],
        timestamp=timestamp
    )

    # 构造请求参数
    params = {
        "keyword": keyword,
        "page": page,
        "timestamp": timestamp,
        "sign": sign,
        **CRYPTO_CONFIG.get("extra_params", {})
    }

    logger.info(f"请求第 {page} 页: keyword={keyword}")

    response = session.get(
        TARGET_URL,
        params=params,
        timeout=10
    )
    response.raise_for_status()

    data = response.json()
    logger.info(f"获取到 {len(data.get('list', []))} 条记录")
    return data


def crawl(keyword: str, max_pages: int = 10) -> list:
    """
    爬取多页数据

    Args:
        keyword: 搜索关键词
        max_pages: 最大页数

    Returns:
        所有记录列表
    """
    session = build_session()
    all_records = []

    for page in range(1, max_pages + 1):
        try:
            data = fetch_page(session, page=page, keyword=keyword)
            records = data.get("list", [])

            if not records:
                logger.info(f"第 {page} 页无数据，停止翻页")
                break

            all_records.extend(records)
            logger.info(f"累计获取: {len(all_records)} 条")

            # 礼貌延迟（避免触发频率限制）
            time.sleep(1)

        except requests.HTTPError as e:
            logger.error(f"HTTP 错误: {e}")
            if e.response.status_code in (401, 403):
                logger.error("认证失败，请刷新 session_state.json")
                break
            raise
        except Exception as e:
            logger.error(f"第 {page} 页请求失败: {e}")
            raise

    return all_records


def main():
    """主入口"""
    keyword = "test"  # 修改为实际关键词
    records = crawl(keyword, max_pages=5)

    print(f"\n共获取 {len(records)} 条记录")
    if records:
        print("样本数据（第一条）:")
        print(json.dumps(records[0], ensure_ascii=False, indent=2))

    # 保存结果
    with open("output.json", "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    print("结果已保存到 output.json")


if __name__ == "__main__":
    main()
```

---

## config.py 模板

```python
"""
爬虫配置文件
修改此文件中的 TARGET_URL、HEADERS、CRYPTO_CONFIG
"""

# 目标 API URL（从 list_network_requests 获取）
TARGET_URL = "https://example.com/api/search"

# 请求头（从浏览器 Network 面板复制，去除 Cookie 字段）
# 保留：User-Agent, Referer, Origin, Content-Type, Accept-Language 等
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...",
    "Referer": "https://example.com/search",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    # 不要在这里包含 Cookie，由 _load_cookies() 处理
}

# 加密配置（来自 extraction 阶段的 fixtures.json）
CRYPTO_CONFIG = {
    "key": "your_hardcoded_key_here",      # 从 fixtures.json 中获取
    "iv": "your_iv_here",                  # 如果算法需要 IV
    "algorithm": "aes-128-cbc",            # 算法类型（仅供文档说明）
    "extra_params": {}                     # 其他固定参数
}
```

---

## requirements.txt 典型内容

```
# HTTP 请求
requests>=2.31.0

# 加密库（根据算法选择）
pycryptodome>=3.20.0    # AES/RSA/DES/PKCS1 等标准算法
gmssl>=3.2.2            # SM2/SM3/SM4 国密算法

# 可选：HTTP/2 支持（某些网站需要）
# httpx>=0.27.0

# 可选：TLS 指纹伪造（高反爬网站需要）
# curl_cffi>=0.7.0
```

---

## Cookie / Token 处理

### 从 `save_session_state` 导出 cookies

```
save_session_state(name: "crawler_session")
→ 保存到 ~/.deepspider/data/sessions/crawler_session.json
```

将 session 文件中的 cookies 转换为爬虫可用的格式：

```python
# 工具函数：将 DeepSpider session 转为 requests cookies
def load_ds_session(session_path: str) -> dict:
    """加载 DeepSpider 导出的 session state"""
    import json
    with open(session_path) as f:
        state = json.load(f)
    return {
        "cookies": state.get("cookies", []),
        "local_storage": state.get("localStorage", {}),
        "session_storage": state.get("sessionStorage", {})
    }
```

### Token 刷新策略

如果 token 有有效期（通常 2-24 小时），爬虫需要处理过期情况：

```python
def _refresh_session_if_needed(session: requests.Session, response: dict) -> bool:
    """检查响应中的 token 过期信号"""
    error_codes = response.get("code", 0)
    if error_codes in (401, 10001, -1):  # 根据目标网站实际错误码调整
        logger.warning("Token 已过期，需要重新登录")
        return False
    return True
```

---

## TLS 指纹考量

某些高反爬网站会验证 TLS 指纹（ClientHello fingerprint）。标准 `requests` 库使用 Python 默认 TLS，可能被识别。

### 判断是否需要处理

- 用 `requests` 请求返回 403/400，但浏览器正常 → 可能是 TLS 指纹问题
- 用 `requests` 加上正确 Cookie/Headers 仍被拒绝 → 大概率是 TLS 指纹

### curl_cffi 集成（模拟浏览器 TLS）

```python
# 替换 requests 为 curl_cffi
from curl_cffi import requests as cffi_requests

session = cffi_requests.Session(impersonate="chrome120")
# 其余代码与 requests 兼容
```

```
# requirements.txt 中添加
curl_cffi>=0.7.0
```

---

## 错误处理与重试模式

```python
import time
from functools import wraps

def retry_on_failure(max_retries: int = 3, delay: float = 2.0):
    """装饰器：失败自动重试"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except requests.HTTPError as e:
                    # 4xx 错误不重试（客户端问题）
                    if 400 <= e.response.status_code < 500:
                        raise
                    last_error = e
                    logger.warning(f"第 {attempt + 1} 次失败: {e}，{delay}s 后重试")
                    time.sleep(delay * (attempt + 1))  # 指数退避
                except Exception as e:
                    last_error = e
                    logger.warning(f"第 {attempt + 1} 次失败: {e}，{delay}s 后重试")
                    time.sleep(delay * (attempt + 1))
            raise last_error
        return wrapper
    return decorator


@retry_on_failure(max_retries=3, delay=2.0)
def fetch_with_retry(session, page, keyword):
    return fetch_page(session, page=page, keyword=keyword)
```

---

## 验证爬虫输出

爬虫生成后，必须执行以下验证：

```bash
# 1. 依赖安装
pip install -r requirements.txt

# 2. 单次请求验证（不翻页）
python main.py

# 3. 对比浏览器中同一查询的结果
# 在 DeepSpider 中执行同样的搜索，截图或记录结果
# 对比 output.json 中第一条记录与浏览器中的数据
```

**验证通过标准**：
- Python 爬虫返回的数据与浏览器中同一查询结果的关键字段完全一致
- 无报错，HTTP 状态码为 200
- 加密参数被服务端正确验证（未返回签名错误）
- 运行期间没有启动、连接或要求预先启动任何浏览器进程

---

## 退出条件（Exit Condition）

满足以下所有条件，handoff 阶段完成：

- [ ] 项目目录结构完整（main.py、config.py、requirements.txt；动态生成逻辑存在时包含 crypto.py、fixtures.json）
- [ ] `python main.py` 运行无报错
- [ ] HTTP 响应状态码 200，服务端未返回签名/认证错误
- [ ] Python 输出数据与浏览器同查询结果关键字段一致
- [ ] 运行时不依赖浏览器、CDP 或浏览器自动化框架
- [ ] `request-chain.md` 更新为 `handoff-complete` 状态
- [ ] `/ds:crawl` 输出包含 `test_result.success: true` 和 `records_count > 0`
