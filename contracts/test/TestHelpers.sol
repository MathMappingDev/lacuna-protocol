// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {LacunaPool} from "../LacunaPool.sol";

contract TestToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice Delivers one unit less than requested. The pool must reject it.
contract TestTaxToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - 1;
        return true;
    }
}

/// @notice Returns nine tenths of the ETH it receives. Used to exercise the relay.
contract TestSink {
    function bounce() external payable {
        uint256 back = (msg.value * 9) / 10;
        (bool ok, ) = msg.sender.call{value: back}("");
        require(ok, "bounce");
    }
}

/// @notice Pulls one token and pays another, plus one unit of a bonus token when one is set.
contract TestExchange {
    function swap(
        address tokenIn,
        address tokenOut,
        address bonus,
        uint256 amountIn,
        uint256 amountOut
    ) external {
        TestToken(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        TestToken(tokenOut).transfer(msg.sender, amountOut);
        if (bonus != address(0)) TestToken(bonus).transfer(msg.sender, 1);
    }

    /// @notice Pulls two tokens and mints an LP token back to the caller.
    function addLiquidity(
        address tokenA,
        address tokenB,
        address lp,
        uint256 amountA,
        uint256 amountB,
        uint256 minted
    ) external {
        TestToken(tokenA).transferFrom(msg.sender, address(this), amountA);
        TestToken(tokenB).transferFrom(msg.sender, address(this), amountB);
        TestToken(lp).mint(msg.sender, minted);
    }
}

contract TestNFT {
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => address) public approved;

    function mint(address to, uint256 id) external {
        require(ownerOf[id] == address(0), "minted");
        ownerOf[id] = to;
    }

    function approve(address spender, uint256 id) external {
        require(ownerOf[id] == msg.sender, "owner");
        approved[id] = spender;
    }

    function transferFrom(address from, address to, uint256 id) public {
        require(ownerOf[id] == from, "from");
        require(msg.sender == from || approved[id] == msg.sender, "spender");
        approved[id] = address(0);
        ownerOf[id] = to;
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        transferFrom(from, to, id);
        if (to.code.length > 0) {
            require(
                IERC721Receiver(to).onERC721Received(msg.sender, from, id, "") ==
                    IERC721Receiver.onERC721Received.selector,
                "receiver"
            );
        }
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @notice Takes an NFT and an ERC-20, then returns the NFT. Stands in for an f(x) position.
contract TestPosition {
    function touch(address payment, address nft, uint256 id, uint256 cost) external {
        if (cost > 0) TestToken(payment).transferFrom(msg.sender, address(this), cost);
        TestNFT(nft).transferFrom(msg.sender, address(this), id);
        TestNFT(nft).transferFrom(address(this), msg.sender, id);
    }
}

/// @notice Pool with a tiny tree, so a test can open the next tree without 65,536 notes.
contract TreePool is LacunaPool {
    uint256 private immutable cap;

    constructor(address hasher_, address verifier_, address treasury_, uint256 cap_)
        LacunaPool(hasher_, verifier_, treasury_)
    {
        if (cap_ == 0 || cap_ > (1 << LEVELS)) revert BadValue();
        cap = cap_;
    }

    function _treeCapacity() internal view override returns (uint256) {
        return cap;
    }
}
