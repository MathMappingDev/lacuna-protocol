// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity 0.8.19;

contract LacunaVerifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 21446964253220821157170886994202546460054668148709369822709310621481002278075;
    uint256 constant alphay  = 10613781307858454492435589426783434662216984890156495584275528227879676616336;
    uint256 constant betax1  = 10672731012540375288445027204058488957510983345529782533103278014786335079828;
    uint256 constant betax2  = 6974779226055814814203100765292100368518979738201084538016000851986762743605;
    uint256 constant betay1  = 20612504942670677509968738110848994327750439028266140282095957798454298022706;
    uint256 constant betay2  = 20267945347568422900918593698429349643254221694329497859193294954257419951035;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 17886516113235733418382298475196101769822871762233346741817476325957339673971;
    uint256 constant deltax2 = 20304236842889103688884995174266312740163282964993066654669638832339145287798;
    uint256 constant deltay1 = 20066166283212173964091330040435784853465934484540018345013174121104725546697;
    uint256 constant deltay2 = 9288949259688455654826209182521343865427215460740427961138919264017081761864;

    
    uint256 constant IC0x = 1277308239435359588448885698193476144453838579241954638405428599359212405047;
    uint256 constant IC0y = 4982648224298449547379991851002837718157148121743386690514871426705982920688;
    
    uint256 constant IC1x = 19787433544697700897405916717236353007703800836335565568445047817716230100304;
    uint256 constant IC1y = 9148690527605290074940401007082722590440554773205271089027906877353046100193;
    
    uint256 constant IC2x = 5720380108959594004765845877674204934393519845847088343635757164073387246634;
    uint256 constant IC2y = 13540093270146516892365731598037389699654334108471908726782468654116491741194;
    
    uint256 constant IC3x = 13534759874767809844856214610194478416726162709460737194546982875942950842131;
    uint256 constant IC3y = 7581264963691070023282707958551544724219306757343683431936491590748090610764;
    
    uint256 constant IC4x = 757128625067779667187106916606376498937962129847662047272600893944455818363;
    uint256 constant IC4y = 11170718436220987454173964750577593501088211008412884617763023630767479187159;
    
    uint256 constant IC5x = 11859173318555702687041549852811320401991276578179137731454391412447196324336;
    uint256 constant IC5y = 18540780981531318321674946767703894345712762066621129566061577200208681576338;
    
    uint256 constant IC6x = 4036191802641882199705324654930133004116654835551248007866350261998469448730;
    uint256 constant IC6y = 9197611565227932424982041761349876051464883806098454877183278240947726827704;
    
    uint256 constant IC7x = 13634998721637983940855500862851828365913075727682013623584568544872652115792;
    uint256 constant IC7y = 20103638272671207296562299950607350225303513411198345767568915589043795661557;
    
    uint256 constant IC8x = 8268114042337146256155416034897107009827033944252061156229630556368629587615;
    uint256 constant IC8y = 15444209286982576022345102421573816101316378894881224296656088902643029903482;
    
    uint256 constant IC9x = 18072174161061349208509139395794296232313013269922935798206149377949116046515;
    uint256 constant IC9y = 6515866457751016208807514566661731963272918847680676991745683630611548338491;
    
    uint256 constant IC10x = 9603101279754598745673448663204975796074815787785352185161291278772918867800;
    uint256 constant IC10y = 3685887836312085227540650624206958974647516320850712488476676308548962196817;
    
    uint256 constant IC11x = 8797248331965062993786445917030094725575293907993124859447835246175516582513;
    uint256 constant IC11y = 4496848196502933237274737941146596102263230411809358854676301083812526985190;
    
    uint256 constant IC12x = 18546801747617165053917056825585155677435519935420125829460457665648400466505;
    uint256 constant IC12y = 7151497992991909897290889513060343661559423867125195474722101969308446207011;
    
    uint256 constant IC13x = 6414264863904732811337973571205698957818015304635460076394950868391961199018;
    uint256 constant IC13y = 19111518875336717255233959051740906120630972823054070298809199601855000257238;
    
    uint256 constant IC14x = 1026869644217527925669763651941283236225756759207012512988176738760006598205;
    uint256 constant IC14y = 2532896446707242334221946139520910495965489531475468215327467528787114681657;
    
    uint256 constant IC15x = 9449577995170562307023284416123942564191886767772585889262637065649360414015;
    uint256 constant IC15y = 14668238363237611219674766334846820952736880575727410360808270133361910613062;
    
    uint256 constant IC16x = 16181045648366770828459454408085397943478554812681181032243246017043284464680;
    uint256 constant IC16y = 1612272012311544801844371535459313329202366049741349882730605886452876500838;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[16] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                
                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))
                
                g1_mulAccC(_pVk, IC12x, IC12y, calldataload(add(pubSignals, 352)))
                
                g1_mulAccC(_pVk, IC13x, IC13y, calldataload(add(pubSignals, 384)))
                
                g1_mulAccC(_pVk, IC14x, IC14y, calldataload(add(pubSignals, 416)))
                
                g1_mulAccC(_pVk, IC15x, IC15y, calldataload(add(pubSignals, 448)))
                
                g1_mulAccC(_pVk, IC16x, IC16y, calldataload(add(pubSignals, 480)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            
            checkField(calldataload(add(_pubSignals, 320)))
            
            checkField(calldataload(add(_pubSignals, 352)))
            
            checkField(calldataload(add(_pubSignals, 384)))
            
            checkField(calldataload(add(_pubSignals, 416)))
            
            checkField(calldataload(add(_pubSignals, 448)))
            
            checkField(calldataload(add(_pubSignals, 480)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
