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
    uint256 constant deltax1 = 16513763123732729114878335348103005389712561164182098182868398744568367502665;
    uint256 constant deltax2 = 5253566663863492739749869541750468784733320212048749717518403321786891885105;
    uint256 constant deltay1 = 20639536167141150882508233882107047139737047878167125289422025147027700394890;
    uint256 constant deltay2 = 6168499814992721517990130636617167528913390940265162070980538486461337532628;

    
    uint256 constant IC0x = 2486311268243748815238072792177676580403639420195316840392466111832490061467;
    uint256 constant IC0y = 20735870275567696578187731281042662664490472837781841078024476355103558966777;
    
    uint256 constant IC1x = 20520752987050908237682331212653752518151867133079202559771650425502412364889;
    uint256 constant IC1y = 8239187462738864813283197506585499184891609476828166467414297032202528225744;
    
    uint256 constant IC2x = 4414064271466816919641351288010663297838992676941798467205909851092473980040;
    uint256 constant IC2y = 10409089420153327613604196530793507534400875198241676298338617544114806085826;
    
    uint256 constant IC3x = 15613054178074066164178241244444954992130236835547578854103491048164712827393;
    uint256 constant IC3y = 7235249607309846620239193457028189836180594230306187233167012121857668031981;
    
    uint256 constant IC4x = 13989425499054650477759467141897660285626511237947126621811162410285171653355;
    uint256 constant IC4y = 20030300186221177152855475150046421002502601068162393044857720803587151141342;
    
    uint256 constant IC5x = 19893107686930791187172507919389405954190360643872162051042791307063437531679;
    uint256 constant IC5y = 3643114049060609203346109965155336582787358951600173685919450740244777701012;
    
    uint256 constant IC6x = 15863727451572457312428661317190151498319885281806706800617262884260555004297;
    uint256 constant IC6y = 8995690357184604589769673837910269004601328311073914076179258968511025389938;
    
    uint256 constant IC7x = 11826995983794748347978310029106765616552650857173568037196567684561102806185;
    uint256 constant IC7y = 15399609913319657943181523973188849393240194246532954620518035903903602952312;
    
    uint256 constant IC8x = 12282522444651735230325865869490273840975466261844271325625922967995204812587;
    uint256 constant IC8y = 8851963099690833028366458347054903987697622002519781369862367926504939226698;
    
    uint256 constant IC9x = 4887666117488225202172187545310895102311523890016930038019347236892321579720;
    uint256 constant IC9y = 13803812623471200177546260238765883008501723170586879371997288160202261207217;
    
    uint256 constant IC10x = 3694604245460340246748999472816945368970233509147176447914753591308870701863;
    uint256 constant IC10y = 14331200007770309561444119864002289234625091863543100268100495329474205603768;
    
    uint256 constant IC11x = 19840424385484316220480562109148865465336732543963998018418203633327637853602;
    uint256 constant IC11y = 6390275553601680864935355337756059524651841793219022968660921228025566749705;
    
    uint256 constant IC12x = 18655297704879992148057677915128268175618467495285818545006315328516315453915;
    uint256 constant IC12y = 10176372822694169218147919929470523855418924634290734278094427256395201760340;
    
    uint256 constant IC13x = 2008920982344986179352588330951796374596995817072796439266093205913317510250;
    uint256 constant IC13y = 10145228096057327793606481014716914713203579250283438063859220771744915608162;
    
    uint256 constant IC14x = 4935982153531746598462794839253291506524569767756031883405936855346904763626;
    uint256 constant IC14y = 490468124588371709038296288909550677564417304195623972053057310989682293504;
    
    uint256 constant IC15x = 8797358098544569515212859266123423413807875623120810500114486501742243182243;
    uint256 constant IC15y = 6161344159096087541925655593635891757832785097397021068832033792001114915075;
    
    uint256 constant IC16x = 19210633844360602368423102980001818431656617162247016680747863575929564134004;
    uint256 constant IC16y = 2348883753689362399439683527090792123359938211824124183033905792807888965975;
    
    uint256 constant IC17x = 6597371372174980230511840384178570954525953514987957654337923451824202406389;
    uint256 constant IC17y = 21132621571813340815732095823460085048085509604230367800739413103719733226341;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[17] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC17x, IC17y, calldataload(add(pubSignals, 512)))
                

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
            
            checkField(calldataload(add(_pubSignals, 512)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
